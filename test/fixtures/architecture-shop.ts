/**
 * A small order service with evidence for every Feature 3.3 view: HTTP
 * routes, auth middleware, an order workflow (branches, retry, try/catch,
 * switch), an OrderStatus lifecycle, SQL, a payment SDK, a worker, secrets,
 * a sink, and Docker / compose / Kubernetes / CI deployment configuration.
 */
export const SHOP: Record<string, string> = {
  "package.json": JSON.stringify({ name: "shop", main: "src/server.ts", dependencies: { express: "4.0.0", pg: "8.0.0", jsonwebtoken: "9.0.0", stripe: "14.0.0" } }),
  "src/server.ts": `import express from "express";
import { registerRoutes } from "./api/routes";
import { startWorker } from "./worker/jobs";

export function main() {
  const app = express();
  registerRoutes(app);
  startWorker();
  app.listen(8080, "0.0.0.0");
}
`,
  "src/api/routes.ts": `import { requireAuth, login } from "../auth/auth";
import { placeOrder, getOrder } from "../orders/service";

export function registerRoutes(app: any) {
  app.post("/login", (req: any, res: any) => loginRoute(req, res));
  app.post("/orders", (req: any, res: any) => createOrderRoute(req, res));
  app.get("/orders/:id", (req: any, res: any) => showOrderRoute(req, res));
}

export async function loginRoute(req: any, res: any) {
  res.json(await login(req.body.email, req.body.password));
}

export async function createOrderRoute(req: any, res: any) {
  const user = requireAuth(req);
  res.json(await placeOrder(user, req.body.items));
}

export async function showOrderRoute(req: any, res: any) {
  res.json(await getOrder(req.params.id));
}
`,
  "src/auth/auth.ts": `import jwt from "jsonwebtoken";

export function requireAuth(req: any) {
  return verifyToken(req.headers.authorization);
}

export function verifyToken(token: string) {
  return jwt.verify(token, process.env.JWT_SECRET ?? "");
}

export async function login(email: string, password: string) {
  return jwt.sign({ email, password }, process.env.JWT_SECRET ?? "");
}
`,
  "src/orders/model.ts": `export enum OrderStatus {
  Pending = "pending",
  Paid = "paid",
  Shipped = "shipped",
  Cancelled = "cancelled",
  Failed = "failed",
}

export interface Order {
  id: string;
  status: OrderStatus;
  total: number;
}
`,
  "src/orders/service.ts": `import { OrderStatus, type Order } from "./model";
import { insertOrder, loadOrder, saveStatus } from "../db/orders";
import { charge } from "../payments/stripe";

export async function placeOrder(user: any, items: any[]) {
  const order: Order = { id: "o1", status: OrderStatus.Pending, total: items.length };
  await insertOrder(order);
  if (!items.length) {
    throw new Error("empty order");
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await charge(order.total);
      order.status = OrderStatus.Paid;
      await saveStatus(order);
      return order;
    } catch (error) {
      await saveStatus(order);
    }
  }
  order.status = OrderStatus.Failed;
  await saveStatus(order);
  return order;
}

export async function getOrder(id: string) {
  return loadOrder(id);
}

export async function shipOrder(order: Order) {
  if (order.status === OrderStatus.Paid) {
    order.status = OrderStatus.Shipped;
    await saveStatus(order);
  }
}

export async function cancelOrder(order: Order) {
  switch (order.status) {
    case OrderStatus.Pending:
      order.status = OrderStatus.Cancelled;
      await saveStatus(order);
      break;
    default:
      throw new Error("cannot cancel");
  }
}
`,
  "src/db/orders.ts": `const db: any = { query: async (_sql: string, _p: unknown[]) => [] };

export async function insertOrder(order: any) {
  return db.query("INSERT INTO orders (id, status, total) VALUES ($1, $2, $3)", [order.id, order.status, order.total]);
}

export async function loadOrder(id: string) {
  return db.query("SELECT id, status, total FROM orders WHERE id = $1", [id]);
}

export async function saveStatus(order: any) {
  return db.query("UPDATE orders SET status = $1 WHERE id = $2", [order.status, order.id]);
}
`,
  "src/payments/stripe.ts": `import Stripe from "stripe";

const client = new Stripe(process.env.STRIPE_API_KEY ?? "");

export async function charge(amount: number) {
  return client.charges.create({ amount });
}
`,
  "src/worker/jobs.ts": `import { execSync } from "node:child_process";
import { shipOrder } from "../orders/service";

export function startWorker() {
  setInterval(() => processPending(), 60000);
}

export async function processPending() {
  execSync("backup-orders");
  await shipOrder({ id: "o1", status: "paid" as any, total: 1 });
}
`,
  Dockerfile: `FROM node:20-alpine
WORKDIR /app
COPY . .
EXPOSE 8080
CMD ["node", "dist/server.js"]
`,
  "docker-compose.yml": `services:
  api:
    build: .
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: postgres://shop:secret@db:5432/shop
    depends_on:
      - db
      - cache
  db:
    image: postgres:16
    volumes:
      - data:/var/lib/postgresql/data
  cache:
    image: redis:7
  proxy:
    image: nginx:1.27
    ports:
      - "80:80"
    depends_on: [api]
volumes:
  data: {}
`,
  "k8s/app.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-api
  namespace: shop
spec:
  replicas: 3
  selector:
    matchLabels:
      app: shop-api
  template:
    metadata:
      labels:
        app: shop-api
    spec:
      containers:
        - name: api
          image: registry.example.com/shop-api:1.0
          ports:
            - containerPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: shop-api
  namespace: shop
spec:
  selector:
    app: shop-api
  ports:
    - port: 80
      targetPort: 8080
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shop
  namespace: shop
spec:
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: shop-api
                port:
                  number: 80
`,
  ".github/workflows/deploy.yml": `name: deploy
on: [push]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker push registry.example.com/shop-api:1.0
      - run: kubectl apply -f k8s/app.yaml
`,
};
