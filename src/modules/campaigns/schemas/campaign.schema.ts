import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CampaignDocument = Campaign & Document;

@Schema({
  collection: 'campaigns',
  timestamps: { createdAt: true, updatedAt: false },
})
export class Campaign {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: String, default: null, trim: true })
  description: string | null;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;
}

export const CampaignSchema = SchemaFactory.createForClass(Campaign);
