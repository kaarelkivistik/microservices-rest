import express from 'express';
import { json } from 'body-parser';
import mongoose, { Schema } from 'mongoose';
import { MessageSchema, ConversationSchema, BucketSchema } from './schemas';

const { MESSAGES_REST_SERVICE_PORT = 80, MESSAGES_MONGO_SERVICE_HOST = "localhost", MESSAGES_MONGO_SERVICE_PORT = "27017" } = process.env;

/* Mongoose/MongoDB */

const BUCKET_SIZE = 5;

const Bucket = mongoose.model("Bucket", BucketSchema);
const Conversation = mongoose.model("Conversation", ConversationSchema);

mongoose.set("debug", true);

mongoose.connect("mongodb://" + MESSAGES_MONGO_SERVICE_HOST + ":" + MESSAGES_MONGO_SERVICE_PORT + "/messages").then(db => {
	api.listen(MESSAGES_REST_SERVICE_PORT);	
}, error => {
	api.close();
});

/* API */

const api = express();

api.use(json());

api.get("/conversations", (req, res) => {
	const { participant } = req.query;
	
	Conversation.find({
		$or: [{a: participant}, {b: participant}]
	}).exec().then(result => {
		res.send(result);
	}, error => {
		res.status(500).send(error);
	});
});

api.get("/buckets", (req, res) => {
	const { a, b, sequence, limit = 1 } = req.query;
	
	let dbQuery = {
		$or: [{a: a, b: b}, {a: b, b: a}]
	};
	
	if(sequence)
		dbQuery.sequence = sequence;
	
	Bucket.find(dbQuery).sort({
		sequence: -1
	}).limit(parseInt(limit)).exec().then(result => {
		res.send(result);
	}, error => {
		res.status(500).send(error);
	});
});

api.post("/messages", (req, res) => {
	const { from, to, text } = req.body;
	
	const message = {
		from, to, text
	};
	
	Conversation.findOneAndUpdate({
		$or: [{a: from, b: to}, {a: to, b: from}]
	}, {
		$setOnInsert: {
			a: from,
			b: to	
		},
		$inc: {
			messageCount: 1
		},
		$set: {
			lastMessage: message
		}
	}, {
		new: true,
		upsert: true
	}).exec().then(document => {
		const { messageCount } = document;
		
		Bucket.update({
			$or: [{a: from, b: to}, {a: to, b: from}],
			sequence: Math.floor(messageCount / BUCKET_SIZE)
		}, {
			$setOnInsert: {
				a: from,
				b: to	
			},
			$push: {
				messages: message
			}
		}, {
			upsert: true
		}).exec().then(result => {
			res.send(message);
		}, error => {
			res.status(500).send(error);
		});
	}, error => {
		res.status(500).send(error);
	});
});