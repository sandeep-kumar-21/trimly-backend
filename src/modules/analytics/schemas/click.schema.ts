import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ClickDocument = Click & Document;

@Schema({ collection: 'clicks', timestamps: false })
export class Click {
  @Prop({ required: true, index: true, trim: true })
  shortCode: string;

  @Prop({ type: Date, default: Date.now, index: true })
  timestamp: Date;

  @Prop({ type: String, default: null })
  referrer: string | null;

  @Prop({ type: String, default: null })
  userAgent: string | null;

  @Prop({ type: String, default: null })
  ipHash: string;

  @Prop({ type: String, default: null })
  deviceType: string | null;

  @Prop({ type: String, default: null })
  browser: string | null;

  @Prop({ type: String, default: null })
  country: string | null;
}

export const ClickSchema = SchemaFactory.createForClass(Click);
