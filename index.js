const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ObjectId } = require('mongodb');

const admin = require("firebase-admin");



// Config
dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

const stripe = require('stripe')(process.env.PYMENT_GATEWAY_KEY);


const uri = `mongodb+srv://${process.env.USER}:${process.env.PASSWORD}@cluster0.iolobvt.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`

// Middleware
app.use(cors());
app.use(express.json());


const serviceAccount = require("./Firebase_key.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

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
        const usersCollection = db.collection('users');
        const paymentHistoryCollection = db.collection('payments')


        // custom middleware
        const verifyFBToken = async (req, res, next) => {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).send({ message: 'unauthorized access' })
            }

            const token = authHeader.split(' ')[1];
            if (!token) {
                return res.status(401).send({ message: 'unauthorized access' })
            }

            // verify the token
            try {
                const decoded = await admin.auth().verifyIdToken(token);
                req.decoded = decoded;
                next()
            }
            catch (error) {
                return res.status(403).send({ message: 'forbidden access' })
            }
        }

        // Sample Route
        app.get('/', (req, res) => {
            res.send('Parcel server is running');
        });

        //  Get all parcels
        // app.get('/parcels', async (req, res) => {
        //     const parcels = await parcelCollection.find().toArray();
        //     res.send(parcels);
        // });

        // user post
        app.post('/users', async (req, res) => {
            const { email } = req.body
            if (!email) {
                return res.status(404).json({ error: 'user not fount' });
            }

            const existingUser = await usersCollection.findOne({ email });


            if (existingUser) {
                // ✅ Update last_login
                const updateResult = await usersCollection.updateOne(
                    { email },
                    {
                        $set: { last_login: new Date().toISOString() }
                    }
                );

                return res.status(200).send({
                    message: 'User already exists',
                    insertedId: false,
                    updated: updateResult.modifiedCount > 0
                });
            }

            const newUser = req.body

            const result = await usersCollection.insertOne(newUser)
            // console.log(result)
            res.send(result)

        })

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

        // get parcels id
        app.get('/parcels/:id', async (req, res) => {

            try {
                const id = req.params.id;
                const parcel = await parcelCollection.findOne(({ _id: new ObjectId(id) }));

                if (!parcel) {
                    return res.status(404).json({ error: 'Parcel not found' });
                }

                res.json(parcel);
            } catch (error) {
                console.error('Error fetching parcel:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        //payment history add 
        app.post('/payment/success', async (req, res) => {
            const { parcelId, email, amount, method } = req.body;

            if (!parcelId || !email || !amount) {
                return res.status(400).json({ error: 'parcelId, email, and amount are required' });
            }

            try {
                // 1. Update parcel payment status
                const updateResult = await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    { $set: { payment_status: 'paid' } }
                );

                if (updateResult.modifiedCount === 0) {
                    return res.status(404).json({ error: 'Parcel not found or already paid' });
                }

                // 2. Create a payment history entry
                const history = {
                    parcelId: new ObjectId(parcelId),
                    email,
                    amount,
                    method: method || 'unknown',
                    paidAt: new Date()
                };

                await paymentHistoryCollection.insertOne(history);

                res.json({ message: 'Payment marked as paid and history recorded' });
            } catch (err) {
                console.error('Payment success error:', err);
                res.status(500).json({ error: 'Internal server error' });
            }
        });


        //  Add new parcel
        app.post('/parcels', async (req, res) => {
            const newParcel = req.body;
            newParcel.creation_date = new Date()
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

        // pyment success
        app.post('/payments', async (req, res) => {
            const { parcelId, email, amount, transactionId, paymentMethod } = req.body;

            if (!parcelId || !email || !amount) {
                return res.status(400).json({ error: 'parcelId, email, and amount are required' });
            }

            try {
                // Step 1: Update parcel payment status
                const updateResult = await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: {
                            payment_status: 'paid'
                        }
                    }
                );

                if (updateResult.modifiedCount === 0) {
                    return res.status(404).json({ error: 'Parcel not found or already paid' });
                }

                // Step 2: Insert into payment history
                const paymentData = {
                    parcelId: new ObjectId(parcelId),
                    email,
                    amount,
                    transactionId,
                    paymentMethod: paymentMethod || 'unknown',
                    paidAt: new Date()
                };

                const pymentResult = await paymentHistoryCollection.insertOne(paymentData);
                console.log(pymentResult)

                res.status(200).json({
                    message: 'Payment recorded successfully',
                    insertedId: pymentResult.insertedId
                });
            } catch (error) {
                console.error('Payment success error:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // payment history
        // Get payment history for a specific user (sorted by latest first)
        app.get('/payments', verifyFBToken, async (req, res) => {
            const { email } = req.query;

            if (req.decoded.email !== userEmail) {
                return res.status(403).send({message: 'forbidden access'})
            }

            if (!email) {
                return res.status(400).json({ error: 'Email is required' });
            }

            try {
                const history = await paymentHistoryCollection
                    .find({ email })
                    .sort({ paidAt: -1 })
                    .toArray();

                res.json(history);
            } catch (err) {
                console.error('User payment history error:', err);
                res.status(500).json({ error: 'Internal server error' });
            }
        });


        // create payment
        app.post('/create-payment-intent', async (req, res) => {
            const amountInCents = req.body.amountInCents
            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amountInCents, // Amount in cents
                    currency: 'usd',
                    payment_method_types: ['card'],
                });

                res.json({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // tracking api post
        app.post('/tracking', async (req, res) => {
            const { trackingId, parcelId, status, location, message, updated_by = '' } = req.body;

            if (!trackingId || !status || !parcelId) {
                return res.status(400).json({ success: false, message: 'Missing required fields' });
            }

            const trackingUpdate = {
                trackingId,
                parcelId,
                status,
                message,
                updated_by,
                location: location || 'Unknown',
                timestamp: new Date()
            };

            try {
                const result = await trackingCollection.insertOne(trackingUpdate);
                res.send({ success: true, message: 'Tracking update added', id: result.insertedId });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Error adding tracking update', error });
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
