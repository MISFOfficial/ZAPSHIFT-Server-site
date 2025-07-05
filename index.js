const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ObjectId } = require('mongodb');

// Config
dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

const uri = `mongodb+srv://${process.env.USER}:${process.env.PASSWORD}@cluster0.iolobvt.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0;`

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Setup
const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

async function run() {
    try {
        await client.connect();
        const db = client.db('parcelDB');
        const parcelCollection = db.collection('parcels');

        // Sample Route
        app.get('/', (req, res) => {
            res.send('Parcel server is running');
        });

        //  Get all parcels
        app.get('/parcels', async (req, res) => {
            const parcels = await parcelCollection.find().toArray();
            res.send(parcels);
        });

        // get user parcels
        app.get('/parcels', async (req, res) => {
            const { email } = req.query;

            // If email is provided, match parcels created by that user
            const query = email ? { created_by: email } : {};

            try {
                const parcels = await parcelCollection
                    .find(query)
                    .sort({ creation_date: -1 }) // Sort by newest first
                    .toArray();

                res.send(parcels);
            } catch (error) {
                res.status(500).send({ message: 'Failed to fetch parcels', error });
            }
        });


        //  Add new parcel
        app.post('/parcels', async (req, res) => {
            const newParcel = req.body;
            const result = await parcelCollection.insertOne(newParcel);
            res.send(result);
        });

        // Delete parcel
        app.delete('/parcels/:id', async (req, res) => {
            const { id } = req.params;

            try {
                const result = await parcelCollection.deleteOne({ _id: new ObjectId(id) });

                if (result.deletedCount === 1) {
                    res.send({ success: true, message: 'Parcel deleted successfully' });
                } else {
                    res.status(404).send({ success: false, message: 'Parcel not found' });
                }
            } catch (error) {
                console.error('Delete error:', error);
                res.status(500).send({ success: false, message: 'Failed to delete parcel', error });
            }
        });

    } catch (err) {
        console.error(err);
    }
}

run().catch(console.dir);

// Start Server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
