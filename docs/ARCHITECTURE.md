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
      └──────────────────────┘                          └─────────┬─────────┘
                                                                    │
                                                          NetworkPolicy: only
                                                          `backend` pods may
                                                          reach Mongo
                                                                    │
                                                          ┌─────────▼─────────┐
                                                          │  mongo StatefulSet │
                                                          │  (1 replica, PVC)  │
                                                          └─────────────────────┘
```

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
- **NetworkPolicy** — default-deny on Mongo except from backend pods, so the
  database is not reachable from the frontend or from outside the cluster.

## Request flow

1. Browser hits the Ingress host on `/`.
2. Ingress routes to the `frontend` Service → a frontend pod serves the
   built React app.
3. The React app calls `/api/messages` (REST, message history) and opens a
   `/socket.io` WebSocket connection, both same-origin — Ingress routes
   these paths to the `backend` Service.
4. The backend pod reads/writes messages in MongoDB over the internal
   `mongo` Service, and broadcasts new messages to all connected clients via
   Socket.io.
