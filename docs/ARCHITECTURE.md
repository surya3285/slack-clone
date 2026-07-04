# Architecture

A minimal three-tier chat app, used as a hands-on Kubernetes learning project:
containerize each tier independently, deploy them as separate microservices,
and wire them together with Kubernetes objects instead of a single monolith
or a `docker-compose.yml`.

```
                        ┌───────────────────────────┐
                        │        Ingress             │
                        │  (nginx-ingress / ALB)     │
                        │  /        → frontend:80    │
                        │  /api     → backend:5000   │
                        │  /socket.io → backend:5000 │
                        └──────────────┬─────────────┘
                                       │
                ┌──────────────────────┼──────────────────────┐
                │                                              │
      ┌─────────▼─────────┐                          ┌────────▼────────┐
      │ frontend Deployment│                          │ backend Deployment│
      │ React static build  │  REST + WebSocket calls │ Express + Socket.io│
      │ served by nginx     │ ───────────────────────▶│                    │
      │ 2 replicas           │                          │ 2 replicas, HPA'd │
      └──────────────────────┘                          └─────┬──────┬─────┘
                                                                │      │
                                        NetworkPolicy: only     │      │ NetworkPolicy: only
                                        `backend` pods may       │      │ `backend` pods may
                                        reach Mongo               │      │ reach Redis
                                                                  │      │
                                          ┌───────────────────────▼┐   ┌▼──────────────────┐
                                          │   mongo StatefulSet     │   │  redis Deployment  │
                                          │   (1 replica, PVC)      │   │  (1 replica, no PVC)│
                                          └──────────────────────────┘   └─────────────────────┘
```

Redis isn't part of the app's data model — it's a pub/sub broker the two
backend replicas use to broadcast Socket.IO events to each other. See
"Why Redis" below.

## Why microservices instead of a monolith

Each tier (frontend, backend, database) is its own container, its own
Deployment/StatefulSet, and its own Service. They scale, fail, and restart
independently:

- If the backend crashes, the frontend still serves static assets (it just
  can't fetch data) instead of the whole app going down.
- The backend can be scaled to 5 replicas under load (see the HPA) without
  touching the frontend or database.
- Compare this to the Docker Compose version of this kind of app, where all
  tiers typically live in one `docker-compose.yml` on a single host with no
  built-in scaling, self-healing, or rolling updates. Kubernetes adds
  orchestration on top of what Compose gives you: scheduling pods across
  nodes, restarting failed containers, rolling deployments, and service
  discovery via DNS.

## Tiers

| Tier | Tech | K8s workload | Exposed as |
|---|---|---|---|
| Frontend | React (Vite), served by nginx | `Deployment` (2 replicas) | `Service` (ClusterIP) behind Ingress |
| Backend | Node.js, Express, Socket.io | `Deployment` (2 replicas, `HorizontalPodAutoscaler`) | `Service` (ClusterIP) behind Ingress |
| Database | MongoDB | `StatefulSet` (1 replica) + `PersistentVolumeClaim` | headless `Service` (internal only) |
| Broker | Redis (Socket.IO adapter only) | `Deployment` (1 replica, no PVC) | `Service` (ClusterIP, internal only) |

## Why Redis

Socket.IO's default room/broadcast state is per-process, in-memory. With 2
backend replicas behind the Ingress, two different users' browsers land on
sticky sessions pinned to (usually) *different* pods. If pod A tries to
`io.to(userRoom).emit(...)` for a user whose socket is actually connected to
pod B, pod A has no way to know that socket exists — the event silently goes
nowhere. The `@socket.io/redis-adapter` fixes this by having every backend
pod publish/subscribe through Redis instead of only broadcasting to its own
local sockets, so a message sent on pod A reaches a user connected to pod B.
This is a standard requirement any time you scale a stateful WebSocket
server horizontally — Redis here holds no data of its own; killing it just
means live delivery pauses until a replacement pod is ready.

## Kubernetes objects used

- **Namespace** (`slack-clone`) — isolates this app's resources.
- **Deployments** — frontend and backend; stateless, horizontally scalable.
- **StatefulSet** — Mongo; stable network identity + persistent storage.
- **Services** — ClusterIP for internal routing; a headless service for
  Mongo so the backend can address it by a stable DNS name
  (`mongo.slack-clone.svc.cluster.local`).
- **PersistentVolumeClaim** (via `volumeClaimTemplates`) — durable storage
  for Mongo's data directory, independent of pod restarts.
- **ConfigMap / Secret** — non-sensitive config (e.g. `PORT`) vs. sensitive
  config (Mongo credentials, connection string) kept separate.
- **Ingress** — single entrypoint that path-routes `/`, `/api`, and
  `/socket.io` to the right service, instead of exposing every service via
  its own NodePort.
- **HorizontalPodAutoscaler** — scales the backend on CPU utilization
  (requires `metrics-server`).
- **NetworkPolicy** — default-deny on Mongo and Redis except from backend
  pods, so neither is reachable from the frontend or from outside the
  cluster.

## Request flow

1. Browser hits the Ingress host on `/`.
2. Ingress routes to the `frontend` Service → a frontend pod serves the
   built React app.
3. The React app authenticates against `/api/auth` (JWT-based signup/login),
   then uses that token for `/api/users/search` and `/api/conversations`
   (REST) and to authenticate a `/socket.io` WebSocket connection — all
   same-origin, with Ingress routing these paths to the `backend` Service.
4. The backend pod reads/writes users, conversations, and messages in
   MongoDB over the internal `mongo` Service. Every connected socket joins a
   room keyed by its own user id; sending a message publishes `message:new`
   and `conversation:updated` to both participants' user rooms via the
   Redis adapter, so delivery works regardless of which backend pod either
   user's socket happens to be connected to.

Because the backend runs multiple replicas, the Ingress is also configured
with cookie-based session affinity (`nginx.ingress.kubernetes.io/affinity:
cookie`) — Socket.IO's *handshake* (the initial HTTP long-polling exchange
before it upgrades to a WebSocket) is tied to whichever pod accepted the
first request, so a given client's own requests must consistently land on
the same pod for the handshake itself to succeed. That's a separate concern
from the Redis adapter: affinity keeps one client's own connection stable;
Redis lets pods broadcast to *other* clients connected elsewhere.
