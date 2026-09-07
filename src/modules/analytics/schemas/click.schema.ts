import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ClickDocument = Click & Document;

@Schema({ collection: 'clicks', timestamps: false })
export class Click {
  @Prop({ required: true, index: true, trim: true })
  shortCode: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  userId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Campaign', default: null, index: true })
  campaignId: Types.ObjectId | null;

  @Prop({ type: Date, default: Date.now, expires: '60d', index: true })
  timestamp: Date;

  @Prop({ type: String, default: null, index: true })
  ipHash: string;

  @Prop({ type: String, default: null })
  referrer: string | null;

  @Prop({ type: String, default: null })
  userAgent: string | null;

  @Prop({ type: String, default: null })
  deviceType: string | null;

  @Prop({ type: String, default: null })
  browser: string | null;

  @Prop({ type: String, default: null })
  os: string | null;

  @Prop({ type: String, default: null, index: true })
  country: string | null;

  @Prop({ type: String, default: null })
  city: string | null;

  @Prop({ type: String, default: null })
  region: string | null;

  @Prop({ type: Boolean, default: false, index: true })
  isQrScan: boolean;

  @Prop({ type: String, default: null })
  utmSource: string | null;

  @Prop({ type: String, default: null })
  utmMedium: string | null;

  @Prop({ type: String, default: null })
  utmCampaign: string | null;

  @Prop({ type: String, default: null })
  utmTerm: string | null;

  @Prop({ type: String, default: null })
  utmContent: string | null;
}

export const ClickSchema = SchemaFactory.createForClass(Click);

// Compound Indexes for sub-50ms analytics aggregations
ClickSchema.index({ userId: 1, timestamp: -1 });
ClickSchema.index({ shortCode: 1, timestamp: -1 });
ClickSchema.index({ campaignId: 1, timestamp: -1 });
ClickSchema.index({ userId: 1, isQrScan: 1, timestamp: -1 });
ClickSchema.index({ userId: 1, country: 1 });
ClickSchema.index({ userId: 1, shortCode: 1, timestamp: -1 });
