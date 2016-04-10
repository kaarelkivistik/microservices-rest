import express from 'express';
import { json } from 'body-parser';
import mongoose, { Schema } from 'mongoose';
import { MessageSchema, ConversationSchema, BucketSchema } from './schemas';

const { 
	DEBUG,
	MESSAGES_REST_SERVICE_PORT = "80", 
	MESSAGES_MONGO_SERVICE_HOST = "localhost", 
	MESSAGES_MONGO_SERVICE_PORT = "27017" } = process.env;

/* Mongoose/MongoDB */

const BUCKET_SIZE = 5;

const Bucket = mongoose.model("Bucket", BucketSchema);
const Conversation = mongoose.model("Conversation", ConversationSchema);

if(DEBUG) {
	mongoose.set("debug", true);
}

mongoose.connect("mongodb://" + MESSAGES_MONGO_SERVICE_HOST + ":" + MESSAGES_MONGO_SERVICE_PORT + "/messages").then(db => {
	api.listen(MESSAGES_REST_SERVICE_PORT);	
	
	api.close();
	mongoose.disconnect();
}, error => {
	console.log(error);
	
	process.exit(1);
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
	
	const parsedSequence = parseInt(sequence);
	const parsedLimit = parseInt(limit);
	
	const andConditions = [{
		$or: [{a: a, b: b}, {a: b, b: a}]
	}];
	
	if(sequence)
		andConditions.push({
			sequence: {
				"$gte": parsedSequence,
				"$lt": parsedSequence + parsedLimit
			}
		});
		
	Bucket.find({
		$and: andConditions
	}).limit(parsedLimit).sort({sequence: -1}).exec().then(result => {
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

console.log("messages-rest service started");
console.log("  PID=%s", process.pid);
console.log("  DEBUG=%s", DEBUG);
console.log("  MESSAGES_REST_SERVICE_PORT=%s", MESSAGES_REST_SERVICE_PORT);
console.log("  MESSAGES_MONGO_SERVICE_HOST=%s", MESSAGES_MONGO_SERVICE_HOST);
console.log("  MESSAGES_MONGO_SERVICE_PORT=%s", MESSAGES_MONGO_SERVICE_PORT);
console.log("");

function exitOnSignal(signal) {
	process.on(signal, function() {
		console.log("Shutting down.. (%s)", signal);
		
		mongoose.disconnect();
		
		process.exit(0);
	});
}

exitOnSignal("SIGTERM");
exitOnSignal("SIGINT");