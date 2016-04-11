import { difference } from 'underscore';
import Promise from 'promise';
import express from 'express';
import { json } from 'body-parser';
import { MongoClient, Logger, ObjectID } from 'mongodb';
// import mongoose, { Schema } from 'mongoose';
// import { MessageSchema, ConversationSchema, UserSchema, BucketSchema } from './schemas';

const { 
	DEBUG,
	MESSAGES_REST_SERVICE_PORT = "80", 
	MESSAGES_MONGO_SERVICE_HOST = "localhost", 
	MESSAGES_MONGO_SERVICE_PORT = "27017" } = process.env;

/* Mongoose/MongoDB */

const BUCKET_SIZE = 5;
const DATABASE = "messages";
const CONNECTION_URL = "mongodb://" + MESSAGES_MONGO_SERVICE_HOST + ":" + MESSAGES_MONGO_SERVICE_PORT + "/" + DATABASE;

let db, User, Conversation, Bucket;

MongoClient.connect(CONNECTION_URL).then(database => {
	console.log("Connected to %s", CONNECTION_URL);
	
	Logger.setLevel("info");
	
	db = database;
	
	User = db.collection("users");
	Conversation = db.collection("conversations");
	Bucket = db.collection("buckets");
	
	User.createIndex({
		name: 1
	}, {
		unique: true
	});
	
	Bucket.createIndex({
		conversationId: 1,
		sequence: -1
	});
	
	db.command({ 
		shardCollection: DATABASE + ".users",
		unique: true, 
		key: {
			name: 1
		} 
	});
	
	db.command({ 
		shardCollection: DATABASE + ".conversations",
		unique: true, 
		key: {
			_id: 1
		} 
	});
	
	db.command({ 
		shardCollection: DATABASE + ".buckets",
		unique: true, 
		key: {
			conversationId: 1,
			sequence: -1
		} 
	});
	
	api.listen(MESSAGES_REST_SERVICE_PORT);
}, error => {
	console.error("Error connecting to %s", CONNECTION_URL);
	console.error(error);
	
	process.exit(1);
}).catch(exception => {
	console.error(exception);
	
	process.exit(1);
});

/* API */

const api = express();

api.use(json());

api.get("/conversations", (req, res) => {
	const { name } = req.query;
	
	User.findOne({name}).then(user => {
		
		if(user) {
			const { conversations } = user;
			
			Conversation.find({
				_id: {
					$in: conversations
				}
			}).toArray().then(result => {
				res.send(result);	
			});
		} else {
			res.send([]);
		}
	}, error => {
		res.status(500).send(error);
	});
});

api.post("/conversations", (req, res) => {
	const { participants } = req.body;
	
	const conversation = {
		participants,
		messageCount: 0
	};
	
	/*
		1. create a conversation
		2. find users that do not exist yet
		3. create those users
		4. update existing users
		5. respond with conversation id
	*/
	
	Conversation.insertOne(conversation).then(result => {
		const { insertedId } = result;
		
		User.find({
			name: {
				$in: participants
			}
		}).toArray().then(results => {
			const existing = results.map(result => result.name);
			const nonExisting = difference(participants, existing);
			
			const promises = [];
			
			if(nonExisting.length > 0)
				promises.push(User.insertMany(nonExisting.map(name => {
					return {
						name,
						conversations: [insertedId]
					};
				})));
				
			if(existing.length > 0)
				promises.push(User.updateMany({
					name: {
						$in: existing
					}
				}, {
					$push: {
						conversations: insertedId
					}
				}));
			
			Promise.all(promises).then(results => {
				res.send({id: insertedId, participants});
			}, results => {
				res.status(500).send({});
			});
			
		}, error => {
			res.status(500).send(error);
		});
	}, error => {
		res.status(500).send(error);
	});
});

api.get("/buckets", (req, res) => {
	const { conversationId, sequence, limit = 1 } = req.query;
	
	const parsedSequence = parseInt(sequence);
	const parsedLimit = parseInt(limit);
	
	const andConditions = [{
		conversationId
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
	}).limit(parsedLimit).sort({sequence: -1}).toArray().then(result => {
		res.send(result);
	}, error => {
		res.status(500).send(error);
	});
});

api.post("/messages", (req, res) => {
	if(DEBUG)
		console.log(req.body);
	
	const { conversationId, from, to, text } = req.body;
	
	const message = {
		_id: new ObjectID(), timestamp: new Date(), from, to, text
	};
	
	Conversation.findOneAndUpdate({
		_id: ObjectID(conversationId)
	}, {
		$inc: {
			messageCount: 1
		},
		$set: {
			lastMessage: message
		}
	}, {
		new: true
	}).then(result => {
		const { value: document } = result;
		const { messageCount = 0 } = document;
		
		Bucket.update({
			conversationId,
			sequence: Math.floor(messageCount / BUCKET_SIZE)
		}, {
			$push: {
				messages: message
			}
		}, {
			new: true,
			upsert: true
		}).then(result => {
			res.send(message);
		}, error => {
			res.status(500).send(error);
		});
	}, error => {
		res.status(500).send(error);
	}).catch(exception => {
		res.status(500).send({
			error: exception.message
		});
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
		
		db.close();
		
		process.exit(0);
	});
}

exitOnSignal("SIGTERM");
exitOnSignal("SIGINT");