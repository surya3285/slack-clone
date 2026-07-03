# Deployment guide

Two ways to deploy: raw manifests (`k8s/base`) or the Helm chart
(`k8s/helm/slack-clone`). Start with raw manifests to see each object
directly; switch to Helm once you're comfortable — it removes the
credential-duplication between `mongo/secret.yaml` and `backend/secret.yaml`
by generating both from one value.

## 1. Prerequisites

- Docker
- `kubectl`
- A local cluster: [minikube](https://minikube.sigs.k8s.io/) or
  [kind](https://kind.sigs.k8s.io/)
- `helm` (only if using the Helm chart)
- The ingress-nginx addon/controller, and metrics-server (for the backend's
  HPA) — see cluster-specific setup below.

## 2. Start a local cluster

**minikube:**
```bash
minikube start
minikube addons enable ingress
minikube addons enable metrics-server
```

**kind** (needs an ingress-ready cluster config + a separately installed
ingress-nginx controller — see the
[kind ingress guide](https://kind.sigs.k8s.io/docs/user/ingress/)):
```bash
kind create cluster --name slack-clone
kubectl apply -f https://raw.githubusercontent.com/kubernetes-sigs/metrics-server/master/deploy/artifacts/metrics-server.yaml
# then install ingress-nginx per the guide above
```

## 3. Build the images

From the repo root:
```bash
docker build -t slack-clone-backend:latest ./apps/backend
docker build -t slack-clone-frontend:latest ./apps/frontend
```

## 4. Load the images into the cluster

Local clusters don't see your local Docker daemon's images automatically.

**minikube:**
```bash
minikube image load slack-clone-backend:latest
minikube image load slack-clone-frontend:latest
```

**kind:**
```bash
kind load docker-image slack-clone-backend:latest --name slack-clone
kind load docker-image slack-clone-frontend:latest --name slack-clone
```

## 5a. Deploy with raw manifests

```bash
kubectl apply -f k8s/base/namespace.yaml
kubectl apply -f k8s/base/mongo/
kubectl apply -f k8s/base/backend/
kubectl apply -f k8s/base/frontend/
kubectl apply -f k8s/base/ingress.yaml
```

## 5b. Deploy with Helm (instead of 5a)

```bash
helm install slack-clone k8s/helm/slack-clone \
  --namespace slack-clone --create-namespace
```

To change replica counts, resource limits, credentials, etc., edit
`k8s/helm/slack-clone/values.yaml` or pass `--set`/`-f` overrides.

## 6. Verify

```bash
kubectl get pods -n slack-clone
kubectl get deployments -n slack-clone
kubectl get svc -n slack-clone
kubectl get ingress -n slack-clone
```

You should see 1 `mongo-0` pod, 2 `backend-*` pods, and 2 `frontend-*` pods,
all `Running` and `Ready`.

## 7. Access the app

Add the ingress host to `/etc/hosts`:
```bash
# minikube
echo "$(minikube ip) slack-clone.local" | sudo tee -a /etc/hosts

# kind (with a local ingress controller on localhost)
echo "127.0.0.1 slack-clone.local" | sudo tee -a /etc/hosts
```

Then open `http://slack-clone.local`.

No ingress controller set up yet? Apply the NodePort alternative instead and
hit `http://<node-ip>:30080`:
```bash
kubectl apply -f k8s/base/frontend/service-nodeport.yaml
minikube ip   # get <node-ip> on minikube
```

## 8. Verify tier-to-tier connectivity

```bash
# frontend -> backend (from inside a frontend pod)
kubectl exec -n slack-clone deploy/frontend -- wget -qO- http://backend:5000/api/health

# backend -> mongo (check backend logs for a successful connection)
kubectl logs -n slack-clone deploy/backend | grep -i mongo

# confirm mongo is NOT reachable from the frontend (NetworkPolicy working)
kubectl exec -n slack-clone deploy/frontend -- wget -qO- --timeout=3 http://mongo:27017 || echo "blocked as expected"
```

## 9. Troubleshooting

- **CrashLoopBackOff on backend** — usually `MONGO_URI` pointing at the
  wrong host/credentials, or Mongo not ready yet. Check
  `kubectl logs -n slack-clone deploy/backend`.
- **CrashLoopBackOff / OOMKilled on mongo** — the `resources.limits.memory`
  in `k8s/base/mongo/statefulset.yaml` (or `values.yaml`) is too low for
  your data size; raise it.
- **ImagePullBackOff** — the image wasn't loaded into the cluster (step 4),
  or the tag in the Deployment doesn't match what you built.
- **Ingress 404 / connection refused** — confirm the ingress controller is
  running (`kubectl get pods -n ingress-nginx`) and that `/etc/hosts` points
  at the right IP.
- **Wrong ports** — the backend listens on `5000`, mongo on `27017`,
  frontend/nginx on `80`. If you change `PORT` in the backend ConfigMap,
  update the Service, Deployment probes, and Ingress backend port to match.

## 10. Tear down

```bash
kubectl delete -f k8s/base/ingress.yaml -f k8s/base/frontend/ -f k8s/base/backend/ -f k8s/base/mongo/ -f k8s/base/namespace.yaml
# or, if installed via Helm:
helm uninstall slack-clone -n slack-clone
```

## 11. Moving to AWS EKS

1. Create the cluster (`eksctl create cluster ...`) and push both images to
   ECR instead of loading them locally.
2. Install the
   [AWS Load Balancer Controller](https://kubernetes-sigs.github.io/aws-load-balancer-controller/)
   so `ingressClassName: alb` works (or keep using ingress-nginx via a
   `NodePort`/`LoadBalancer` Service if you'd rather not adopt ALB yet).
3. Use the `gp3` StorageClass for Mongo's PVC instead of the local default.
4. With Helm, copy `k8s/helm/slack-clone/values-eks.yaml.example` to
   `values-eks.yaml`, fill in your ECR registry and AWS Load Balancer
   Controller annotations, and deploy with:
   ```bash
   helm install slack-clone k8s/helm/slack-clone \
     --namespace slack-clone --create-namespace \
     -f k8s/helm/slack-clone/values-eks.yaml
   ```
5. `kubectl get ingress -n slack-clone` will show the ALB's DNS name once
   provisioned — use that (or a Route53 record pointed at it) instead of
   `slack-clone.local`.
