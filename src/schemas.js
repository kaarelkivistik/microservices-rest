import { Schema } from 'mongoose';

export const MessageSchema = new Schema({
	from: {
		type: String,
		required: true
	},
	to: {
		type: String,
		required: true
	},
	text: {
		type: String,
		required: true,
		trim: true
	},
	timestamp: {
		type: Date,
		required: true,
		default: Date.now
	}
});

export const ConversationSchema = new Schema({
	a: {
		type: String
	},
	b: {
		type: String
	},
	messageCount: {
		type: Number
	},
	lastMessage: MessageSchema
});

export const BucketSchema = new Schema({
	a: {
		type: String
	},
	b: {
		type: String
	},
	sequence: {
		type: Number,
		index: true
	},
	messages: [MessageSchema]
});

ConversationSchema.index({a: 1, b: 1});
ConversationSchema.index({b: 1});
BucketSchema.index({a: 1, b: 1});