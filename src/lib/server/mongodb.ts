import { env } from '$env/dynamic/private';
import { MongoClient, ServerApiVersion, type Db } from 'mongodb';

let clientPromise: Promise<MongoClient> | undefined;

function getMongoUri(): string {
	const uri = env.MONGODB_URI || process.env.MONGODB_URI;
	if (!uri) {
		throw new Error('MONGODB_URI is not configured.');
	}
	return uri;
}

export async function getMongoDatabase(): Promise<Db> {
	if (!clientPromise) {
		const client = new MongoClient(getMongoUri(), {
			serverApi: {
				version: ServerApiVersion.v1,
				strict: true,
				deprecationErrors: true
			},
			maxPoolSize: 10,
			serverSelectionTimeoutMS: 10_000
		});

		clientPromise = client.connect().catch((error) => {
			clientPromise = undefined;
			throw error;
		});
	}

	const client = await clientPromise;
	const databaseName = env.MONGODB_DB_NAME || process.env.MONGODB_DB_NAME || 'taskls';
	return client.db(databaseName);
}
