import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserDocument = User & Document;

@Schema({
  collection: 'users',
  timestamps: { createdAt: true, updatedAt: false },
  toJSON: {
    transform: (doc, ret) => {
      delete (ret as any).passwordHash;
      return ret;
    },
  },
})
export class User {
  _id: Types.ObjectId;

  @Prop({ required: true, unique: true, index: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ type: String, default: null })
  name: string | null;

  @Prop({ type: String, default: null })
  avatarUrl: string | null;

  @Prop({
    type: {
      theme: { type: String, default: 'system' },
      timezone: { type: String, default: 'UTC' },
      notificationsEnabled: { type: Boolean, default: true },
    },
    default: { theme: 'system', timezone: 'UTC', notificationsEnabled: true },
  })
  preferences: {
    theme: string;
    timezone: string;
    notificationsEnabled: boolean;
  } | null;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
