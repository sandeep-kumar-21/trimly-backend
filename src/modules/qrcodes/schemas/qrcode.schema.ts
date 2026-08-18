import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type QrCodeDocument = QrCode & Document;

@Schema({ _id: false })
export class QrConfig {
  @Prop({ type: String, default: 'square' })
  dotsStyle: string;

  @Prop({ type: String, default: 'square' })
  cornersStyle: string;

  @Prop({ type: String, default: 'square' })
  cornersDotStyle: string;

  @Prop({ type: String, default: '#000000' })
  dotsColor: string;

  @Prop({ type: String, default: '#ffffff' })
  backgroundColor: string;

  @Prop({ type: String, default: null })
  logoUrl: string | null;

  @Prop({ type: String, default: null })
  centerText: string | null;
}

export const QrConfigSchema = SchemaFactory.createForClass(QrConfig);

@Schema({
  collection: 'qrcodes',
  timestamps: { createdAt: true, updatedAt: false },
})
export class QrCode {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, index: true, unique: true })
  shortCode: string;

  @Prop({ type: QrConfigSchema, required: true })
  qrConfig: QrConfig;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Boolean, default: false })
  isHidden: boolean;
}

export const QrCodeSchema = SchemaFactory.createForClass(QrCode);
