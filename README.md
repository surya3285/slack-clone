# slack-clone

A minimal Slack-style chat app — React frontend, Node.js/Express + Socket.io
backend, MongoDB — built as a hands-on project for learning Docker,
Kubernetes, and microservices. Each tier is containerized separately and
deployed to Kubernetes as independent Deployments/StatefulSets, wired
together with Services, an Ingress, ConfigMaps/Secrets, a
HorizontalPodAutoscaler, and a NetworkPolicy.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit
together and why this uses Kubernetes instead of Docker Compose, and
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for step-by-step build/deploy
instructions (local cluster first, AWS EKS notes included).

## Layout

```
apps/
  frontend/   React app (Vite), Dockerfile
  backend/    Express + Socket.io API, Dockerfile
k8s/
  base/       Raw Kubernetes manifests
  helm/       Helm chart (same app, templated)
docs/
  ARCHITECTURE.md
  DEPLOYMENT.md
```

## Quickstart

```bash
docker build -t slack-clone-backend:latest ./apps/backend
docker build -t slack-clone-frontend:latest ./apps/frontend
# load images into your local cluster, then:
kubectl apply -f k8s/base/namespace.yaml -f k8s/base/mongo/ -f k8s/base/redis/ -f k8s/base/backend/ -f k8s/base/frontend/ -f k8s/base/ingress.yaml
# or: helm install slack-clone k8s/helm/slack-clone --namespace slack-clone --create-namespace
```

Full instructions, including local cluster setup and troubleshooting, are in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
