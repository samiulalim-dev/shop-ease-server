const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const admin = require("firebase-admin");
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
app.use(cors());
app.use(express.json());
const decodedKey = Buffer.from(
  process.env.FIREBASE_SERVICE_ACCOUNT,
  "base64"
).toString();
const serviceAccount = JSON.parse(decodedKey);
// console.log(serviceAccount);
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fe99gj2.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded = decoded;
    // console.log("Decoded Token:", decoded);
    next();
  } catch (error) {
    return res.status(403).json({ message: "Forbidden: Invalid token" });
  }
};

async function run() {
  try {
    const database = client.db("shop-ease");
    const userCollection = database.collection("users");

    app.post("/user", async (req, res) => {
      const user = req.body;
      const existingUser = await userCollection.findOne({ email: user.email });
      if (existingUser) {
        return res.send({ message: "user already exist" });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });
    app.get("/all-user", async (req, res) => {
      try {
        const search = req.query.search || "";
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 4;
        const skip = (page - 1) * limit;

        const filter = {
          $or: [
            { name: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
            { role: { $regex: search, $options: "i" } },
          ],
        };

        const totalUsers = await userCollection.countDocuments(filter);

        const allUsers = await userCollection
          .aggregate([
            { $match: filter },
            {
              $addFields: {
                rolePriority: {
                  $cond: [{ $eq: ["$role", "admin"] }, 1, 0], // admin = 1, others = 0
                },
              },
            },
            {
              $sort: { rolePriority: -1, createdAt: -1 }, // admin first, then newest first
            },
            { $skip: skip },
            { $limit: limit },
          ])
          .toArray();

        res.send({
          allUsers,
          totalUsers,
          totalPages: Math.ceil(totalUsers / limit),
          currentPage: page,
          limit,
        });
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    app.patch("/user/role/:id", verifyFirebaseToken, async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;
      try {
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: { role: role },
        };
        const result = await userCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Error updating role" });
      }
    });

    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("this is shop ease server");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
