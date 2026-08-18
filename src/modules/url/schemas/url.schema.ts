import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UrlDocument = Url & Document;

@Schema({
  collection: 'urls',
  timestamps: { createdAt: true, updatedAt: false },
})
export class Url {
  _id: Types.ObjectId;

  @Prop({ required: true, unique: true, index: true, trim: true })
  shortCode: string;

  @Prop({ required: true, trim: true })
  longUrl: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  userId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Campaign', default: null, index: true })
  campaignId: Types.ObjectId | null;

  @Prop({ type: String, default: null, index: true })
  channel: string | null;

  @Prop({ type: Number, default: 0 })
  clickCount: number;

  @Prop({ type: String, default: null })
  title: string | null;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: String, default: null })
  passwordHash: string | null;

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

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: null })
  expiresAt: Date | null;

  @Prop({ type: Boolean, default: false })
  isHidden: boolean;

  @Prop({ type: Boolean, default: true, index: true })
  visibleAsLink: boolean;

  @Prop({ type: Boolean, default: false, index: true })
  hasQR: boolean;

  @Prop({ type: Types.ObjectId, ref: 'QrCode', default: null, index: true })
  qrCodeId: Types.ObjectId | null;

  @Prop({ type: Boolean, default: false, index: true })
  isCustomAlias: boolean;
}

export const UrlSchema = SchemaFactory.createForClass(Url);
