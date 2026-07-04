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
kubectl apply -f k8s/base/redis/
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

Add the ingress host to `/etc/hosts`. Use `slack-clone.test`, not
`slack-clone.local` — on macOS, `.local` is reserved for Bonjour/mDNS, so
DNS resolution hangs instead of using `/etc/hosts`. `.test` is the
IANA-reserved TLD for local testing and doesn't have this problem.

```bash
# minikube with the docker driver on macOS/Windows: the cluster's IP isn't
# directly reachable from the host, so point at 127.0.0.1 and run
# `minikube tunnel` in a separate terminal (leave it running):
minikube tunnel
echo "127.0.0.1 slack-clone.test" | sudo tee -a /etc/hosts

# minikube with the docker driver on Linux, or any driver where the
# cluster IP is directly routable:
echo "$(minikube ip) slack-clone.test" | sudo tee -a /etc/hosts

# kind (with a local ingress controller on localhost)
echo "127.0.0.1 slack-clone.test" | sudo tee -a /etc/hosts
```

Then open `http://slack-clone.test`.

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
- **Rebuilt an image but the cluster still runs the old code** —
  `minikube image load` compares image *name:tag* against its own cache,
  not content, so re-running `docker build` + `minikube image load` with the
  same `:latest` tag can silently no-op and leave the stale image in place.
  `kubectl rollout restart` won't help either since it just recreates pods
  from whatever image the node already has cached. Force it:
  ```bash
  kubectl scale deployment/backend deployment/frontend -n slack-clone --replicas=0
  minikube image rm slack-clone-backend:latest slack-clone-frontend:latest
  minikube image load slack-clone-backend:latest --overwrite=true
  minikube image load slack-clone-frontend:latest --overwrite=true
  kubectl scale deployment/backend deployment/frontend -n slack-clone --replicas=2
  ```
  (Scaling to 0 first is necessary — `minikube image rm` fails while a
  running container still references the image.) Verify the fix by
  comparing `docker inspect <image>:latest --format '{{.Id}}'` against
  `minikube image ls --format table`.
- **Browser shows old UI after a redeploy** — hard-refresh (the browser may
  have cached the old `index.html`/JS bundle).
- **Socket.io keeps reconnecting / messages never send with 2+ backend
  replicas** — the Ingress needs cookie-based session affinity
  (`nginx.ingress.kubernetes.io/affinity: cookie`, already set in
  `k8s/base/ingress.yaml`) since Socket.io's handshake is stateful and tied
  to whichever pod accepted the first request. Without it, requests
  round-robin across pods and the handshake fails.
- **`.local` hostnames hang in the browser on macOS** — `.local` is reserved
  for Bonjour/mDNS; use `.test` instead (see step 7).

## 10. Tear down

```bash
kubectl delete -f k8s/base/ingress.yaml -f k8s/base/frontend/ -f k8s/base/backend/ -f k8s/base/redis/ -f k8s/base/mongo/ -f k8s/base/namespace.yaml
# or, if installed via Helm:
helm uninstall slack-clone -n slack-clone
```

## 11. Deploying to AWS EKS

This section is specific to this `aws-eks` branch (`main` is local-only).
Tested against an **EKS Auto Mode** cluster, where AWS manages the worker
nodes for you (via Karpenter) instead of you creating a Node Group
yourself.

### 11.1 Prerequisites

- An EKS Auto Mode cluster already created (console: EKS → Create cluster;
  Auto Mode is the default compute option in the current console).
- AWS CLI installed locally, with credentials for an IAM user that has:
  - `AmazonEC2ContainerRegistryPowerUser` (or broader) to push to ECR.
  - An **EKS access entry** (cluster's Access tab → Create access entry)
    granting that same IAM user the `AmazonEKSClusterAdminPolicy` — this is
    separate from IAM permissions and easy to miss; without it,
    `kubectl` commands fail with `Forbidden` even though `aws
    sts get-caller-identity` works fine.
- `kubectl` and `helm` installed locally.

### 11.2 Connect kubectl to the cluster

```bash
aws eks update-kubeconfig --region <region> --name <cluster-name>
kubectl get nodes   # should show your Auto Mode nodes as Ready
```

### 11.3 Build for the right CPU architecture

If you're on Apple Silicon (arm64) but your nodes are Intel/AMD64 (check
with `kubectl describe node | grep instance-cpu-manufacturer`), a plain
`docker build` produces images the nodes can't run — pods fail with
`ErrImagePull: no match for platform in manifest`. Build for the correct
platform explicitly and push straight to ECR:

```bash
aws ecr create-repository --repository-name slack-clone-backend --region <region>
aws ecr create-repository --repository-name slack-clone-frontend --region <region>

aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account_id>.dkr.ecr.<region>.amazonaws.com

docker buildx build --platform linux/amd64 -t <account_id>.dkr.ecr.<region>.amazonaws.com/slack-clone-backend:latest --push ./apps/backend
docker buildx build --platform linux/amd64 -t <account_id>.dkr.ecr.<region>.amazonaws.com/slack-clone-frontend:latest --push ./apps/frontend
```

### 11.4 One-time cluster prerequisites

EKS Auto Mode's built-in ALB support uses its own CRDs
(`eks.amazonaws.com/v1`) and its own EBS CSI driver name
(`ebs.csi.eks.amazonaws.com`) — both different from the classic, separately
installed AWS Load Balancer Controller / EBS CSI driver add-ons. These are
cluster-level, not app-level, so they're applied once, outside the Helm
chart:

```bash
kubectl apply -f k8s/eks/ingressclass.yaml    # ALB IngressClass + scheme
kubectl apply -f k8s/eks/storageclass.yaml    # EBS-backed StorageClass for Mongo
```

Also make sure your cluster's public subnets are tagged
`kubernetes.io/role/elb=1` (and `kubernetes.io/cluster/<cluster-name>=shared`)
— without this, the ALB controller can't figure out where to place the
load balancer and Ingress reconciliation fails with `couldn't
auto-discover subnets`. Default-VPC subnets usually aren't tagged this way
out of the box:

```bash
aws ec2 create-tags --region <region> --resources <subnet-id-1> <subnet-id-2> <subnet-id-3> \
  --tags Key=kubernetes.io/role/elb,Value=1 Key=kubernetes.io/cluster/<cluster-name>,Value=shared
```

### 11.5 Deploy

Copy `k8s/helm/slack-clone/values-eks.yaml.example` to
`values-eks.yaml` (git-ignored — it'll contain your account id) and fill in
your account id/region, then:

```bash
helm install slack-clone k8s/helm/slack-clone \
  --namespace slack-clone --create-namespace \
  -f k8s/helm/slack-clone/values-eks.yaml
```

### 11.6 Verify

```bash
kubectl get pods -n slack-clone      # all 6 should reach Running
kubectl get pvc -n slack-clone       # mongo's PVC should be Bound
kubectl get ingress -n slack-clone   # ADDRESS populates once the ALB is active (a few minutes)
```

Once `ADDRESS` shows an ALB hostname, curl it directly (DNS can take a
minute to propagate after the ALB first goes active):
```bash
curl http://<alb-address>/api/health
```

### 11.7 Tear down (stop billing)

EKS bills by the hour for the control plane regardless of usage — delete
the app and, when you're done testing for the day, the cluster itself:
```bash
helm uninstall slack-clone -n slack-clone
kubectl delete -f k8s/eks/ingressclass.yaml -f k8s/eks/storageclass.yaml
# then delete the cluster itself via the EKS console (or `eksctl delete cluster`)
```

See [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) for the full story behind
each of these steps — none of them were obvious upfront.
