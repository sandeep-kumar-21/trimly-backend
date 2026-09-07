import { Controller, Post, Get, Patch, Delete, Body, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { AddCampaignLinksDto } from './dto/add-campaign-links.dto';
import { AssignExistingLinksDto } from './dto/assign-existing-links.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';

@ApiTags('Campaigns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new campaign' })
  @ApiResponse({ status: 201, description: 'Campaign created successfully.' })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async createCampaign(
    @Body() createCampaignDto: CreateCampaignDto,
    @GetUser('userId') userId: string,
  ) {
    return this.campaignsService.createCampaign(createCampaignDto, userId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all campaigns created by the authenticated user' })
  @ApiResponse({ status: 200, description: 'Returns list of user campaigns with aggregated metrics.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getUserCampaigns(@GetUser('userId') userId: string) {
    return this.campaignsService.getUserCampaigns(userId);
  }

  @Get('channels/all')
  @ApiOperation({ summary: 'Get all distinct marketing channels used by the authenticated user' })
  @ApiResponse({ status: 200, description: 'Returns array of channel names.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getUserChannels(@GetUser('userId') userId: string) {
    return this.campaignsService.getUserChannels(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get campaign details and grouped links by channel with aggregation totals' })
  @ApiParam({ name: 'id', description: 'Campaign ObjectId' })
  @ApiResponse({ status: 200, description: 'Returns campaign details and channel link analytics.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Campaign not found.' })
  async getCampaignDetails(
    @Param('id') id: string,
    @GetUser('userId') userId: string,
  ) {
    return this.campaignsService.getCampaignDetails(id, userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update campaign name, description, or channels' })
  @ApiParam({ name: 'id', description: 'Campaign ObjectId' })
  @ApiResponse({ status: 200, description: 'Campaign updated successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Campaign not found.' })
  async updateCampaign(
    @Param('id') id: string,
    @Body() updateCampaignDto: UpdateCampaignDto,
    @GetUser('userId') userId: string,
  ) {
    return this.campaignsService.updateCampaign(id, updateCampaignDto, userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete campaign and unlink associated short URLs' })
  @ApiParam({ name: 'id', description: 'Campaign ObjectId' })
  @ApiResponse({ status: 200, description: 'Campaign deleted and short URLs unlinked successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Campaign not found.' })
  async deleteCampaign(
    @Param('id') id: string,
    @GetUser('userId') userId: string,
  ) {
    return this.campaignsService.deleteCampaign(id, userId);
  }

  @Post(':id/links')
  @ApiOperation({ summary: 'Batch generate short links across selected marketing channels with automated UTM tracking' })
  @ApiParam({ name: 'id', description: 'Campaign ObjectId' })
  @ApiResponse({ status: 201, description: 'Multi-channel links generated successfully.' })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Campaign not found.' })
  async addCampaignLinksBatch(
    @Param('id') id: string,
    @Body() addCampaignLinksDto: AddCampaignLinksDto,
    @GetUser('userId') userId: string,
  ) {
    return this.campaignsService.addCampaignLinksBatch(id, addCampaignLinksDto, userId);
  }

  @Post(':id/assign-links')
  @ApiOperation({ summary: 'Assign existing short links to this campaign' })
  @ApiParam({ name: 'id', description: 'Campaign ObjectId' })
  @ApiResponse({ status: 200, description: 'Links assigned to campaign successfully.' })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Campaign not found.' })
  async assignExistingLinks(
    @Param('id') id: string,
    @Body() assignDto: AssignExistingLinksDto,
    @GetUser('userId') userId: string,
  ) {
    return this.campaignsService.assignExistingLinks(id, assignDto, userId);
  }

  @Delete(':id/links/:linkId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlink a short link from this campaign' })
  @ApiParam({ name: 'id', description: 'Campaign ObjectId' })
  @ApiParam({ name: 'linkId', description: 'Link ObjectId' })
  @ApiResponse({ status: 200, description: 'Link unlinked from campaign successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Link or Campaign not found.' })
  async unlinkLinkFromCampaign(
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @GetUser('userId') userId: string,
  ) {
    return this.campaignsService.unlinkLinkFromCampaign(id, linkId, userId);
  }
}
