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
    const sellerCollection = database.collection("sellers");
    const productCollection = database.collection("products");

    const verifyAdmin = async (req, res, next) => {
      try {
        const email = req.decoded.email;
        // console.log(email);
        if (!email) {
          return res
            .status(401)
            .send({ message: "Unauthorized: No decoded email" });
        }

        const user = await userCollection.findOne({ email: email });
        // console.log("verifyAdmin check:", email, user?.role);
        if (user?.role !== "admin") {
          return res
            .status(403)
            .json({ message: "Forbidden: Admin access only" });
        }
        next();
      } catch (error) {
        res.status(500).json({ message: "Server error", error });
      }
    };

    const verifySeller = async (req, res, next) => {
      try {
        const email = req.decoded.email;
        if (!email) {
          return res
            .status(401)
            .send({ message: "Unauthorized: No decoded email" });
        }
        const user = await userCollection.findOne({ email: email });
        if (user?.role !== "seller") {
          return res
            .status(403)
            .json({ message: "Forbidden : seller access only" });
        }
        next();
      } catch (error) {
        res.status(500).json({ message: "server error", error });
      }
    };
    // user post method
    app.post("/user", async (req, res) => {
      const user = req.body;
      const existingUser = await userCollection.findOne({ email: user.email });
      if (existingUser) {
        return res.send({ message: "user already exist" });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });
    // seller post method
    app.post("/sellers", async (req, res) => {
      const seller = req.body;
      const existingSeller = await sellerCollection.findOne({
        email: seller.email,
      });
      if (existingSeller) {
        return res.send({ message: "seller already exist" });
      }
      const result = await sellerCollection.insertOne(seller);
      res.send(result);
    });
    app.get("/all-user", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const search = req.query.search || "";
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 5;
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
    app.patch(
      "/user/role/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
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
      }
    );
    app.get(
      "/user/:email",
      verifyFirebaseToken,

      async (req, res) => {
        const { email } = req.params;
        const query = { email: email };
        const result = await userCollection.findOne(query);
        res.send(result);
      }
    );
    // product post in DB
    app.post(
      "/productDetails",
      verifyFirebaseToken,
      verifySeller,
      async (req, res) => {
        const email = req.decoded.email;
        try {
          const product = req.body;

          // ✅ basic validation
          if (!product.productName || !product.price || !product.images) {
            return res
              .status(400)
              .send({ success: false, message: "Missing required fields" });
          }
          // shop address
          const shopAddress = await sellerCollection.findOne({ email: email });
          if (!shopAddress) {
            return res.status(404).send({
              success: false,
              message: "Seller information not found",
            });
          }
          // ✅ insert to MongoDB
          const result = await productCollection.insertOne({
            ...product,
            createdAt: new Date(),
            status: "pending",
            shopName: shopAddress.shopName,
            shopEmail: shopAddress.email,
          });

          res.status(201).send({
            success: true,
            message: "Product added successfully",
            data: result,
          });
        } catch (error) {
          console.error("Error adding product:", error);
          res
            .status(500)
            .send({ success: false, message: "Internal server error" });
        }
      }
    );
    app.get(
      "/myProducts",
      verifyFirebaseToken,
      verifySeller,
      async (req, res) => {
        try {
          const { email, search = "", page, limit } = req.query;
          const filter = search
            ? {
                $or: [
                  {
                    productName: { $regex: search, $options: "i" },
                  },
                  {
                    category: { $regex: search, $options: "i" },
                  },
                  {
                    brand: { $regex: search, $options: "i" },
                  },
                  {
                    shopName: { $regex: search, $options: "i" },
                  },
                ],
              }
            : {};
          const query = { shopEmail: email, ...filter };

          const totalProducts = await productCollection.countDocuments(query);

          const products = await productCollection
            .find(query)
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .sort({ createdAt: -1 })
            .toArray();
          res.send({
            products,
            totalProducts,
            totalPages: Math.ceil(totalProducts / limit),
          });
        } catch (error) {
          res.status(500).send("Internal Server Error");
        }
      }
    );
    app.get("/products/:id", async (req, res) => {
      const id = req.params.id;
      try {
        const products = await productCollection.findOne({
          _id: new ObjectId(id),
        });
        res.send(products);
      } catch (error) {
        res.status(500).send("Internal Server Error");
      }
    });
    app.patch(
      "/updateProduct/:id",
      verifyFirebaseToken,
      verifySeller,
      async (req, res) => {
        try {
          const id = req.params.id;
          const updatedProduct = req.body;

          const filter = { _id: new ObjectId(id) };
          const updateDoc = {
            $set: {
              productName: updatedProduct.productName,
              description: updatedProduct.description,
              price: updatedProduct.price,
              discount: updatedProduct.discount,
              stock: updatedProduct.stock,
              condition: updatedProduct.condition,
              category: updatedProduct.category,
              brand: updatedProduct.brand,
              shipping: updatedProduct.shipping,
              specification: updatedProduct.specification,
              images: updatedProduct.images,
              updatedAt: new Date(),
            },
          };

          const result = await productCollection.updateOne(filter, updateDoc);

          res.send({
            success: true,
            message: "✅ Product updated successfully!",
            result,
          });
        } catch (error) {
          console.error(" Error updating product:", error);
          res.status(500).send({
            success: false,
            message: "Internal server error while updating product",
          });
        }
      }
    );

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
