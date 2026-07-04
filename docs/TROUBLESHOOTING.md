# Troubleshooting log

A record of the real issues hit while building and deploying this project,
and how each was diagnosed and fixed. Kept as a narrative (symptom → root
cause → fix) rather than a quick-reference list, since the *reasoning* is
the useful part for a learning project like this one.

## 1. `.local` hostname hangs forever in the browser (macOS)

**Symptom:** After wiring up the Ingress and adding `slack-clone.local` to
`/etc/hosts`, the site would hang on "loading..." in the browser, even
though `ping` and `curl` with an explicit `Host` header both worked fine.

**Root cause:** macOS reserves the `.local` TLD for Bonjour/mDNS. Browsers
(and some other tools) try a multicast DNS lookup for `.local` names instead
of just trusting `/etc/hosts`, and that lookup hangs since there's no mDNS
responder for a made-up hostname like `slack-clone.local`.

**Fix:** Use `.test` instead — it's the TLD IANA specifically reserves for
local testing and doesn't trigger mDNS. Updated the Ingress host and
`/etc/hosts` entries to `slack-clone.test`.

## 2. Messages never send with 2+ backend replicas (Socket.IO handshake)

**Symptom:** The chat UI would connect, but sending a message did nothing.
Ingress logs showed the client's Socket.IO polling requests bouncing
between two different backend pods, each returning 400s, in a rapid
reconnect loop.

**Root cause:** Socket.IO's handshake starts as a stateful HTTP long-polling
exchange before upgrading to a WebSocket. That state lives in whichever
pod's process accepted the first request. Without session affinity, the
Ingress load-balances each polling request round-robin across both backend
pods, so the second request in the handshake often lands on a pod that has
no idea the session exists — hence the 400s and infinite reconnect loop.

**Fix:** Added cookie-based session affinity to the Ingress
(`nginx.ingress.kubernetes.io/affinity: cookie`), so one client's requests
consistently land on the same pod for the handshake to complete.

## 3. Mongo stuck in CrashLoopBackOff (probe timeout, not a real crash)

**Symptom:** `mongo-0` kept restarting. Logs showed a clean shutdown each
time — mongod itself wasn't crashing.

**Root cause:** The readiness/liveness probes ran `mongosh --eval
db.adminCommand('ping')`, and Kubernetes' default probe timeout is 1
second. `mongosh` is itself a full Node.js process with real startup
overhead, and on a resource-constrained minikube VM (2 CPU) it routinely
took longer than 1 second to respond. The probe timed out, kubelet decided
the container was unhealthy, and killed it — a healthy process, killed for
being "too slow" to answer a check that was too strict.

**Fix:** Added `timeoutSeconds: 5` to both probes.

## 4. Rebuilding an image didn't update the running pods (stale minikube cache)

**Symptom:** After fixing a bug and rebuilding + reloading images into
minikube, the browser kept showing old behavior — eventually traced to the
old *frontend JS bundle* still being served.

**Root cause:** `minikube image load` compares the image by *name:tag*
against its own cache, not by content digest. Rebuilding with the same
`:latest` tag can make it think nothing changed and silently skip reloading
the actual new image. `kubectl rollout restart` didn't help either, since
it just recreates pods using whatever image the node already has cached.

**Fix:** Confirmed via `docker inspect <image> --format '{{.Id}}'` vs.
`minikube image ls` that the digests genuinely differed on the node.
Forced a real reload:
```bash
kubectl scale deployment/backend deployment/frontend -n slack-clone --replicas=0
minikube image rm slack-clone-backend:latest slack-clone-frontend:latest
minikube image load slack-clone-backend:latest --overwrite=true
minikube image load slack-clone-frontend:latest --overwrite=true
kubectl scale deployment/backend deployment/frontend -n slack-clone --replicas=2
```
Scaling to 0 first is required — `minikube image rm` fails while a running
container still references the image.

## 5. Recipient never sees a new message unless they reopen the chat

**Symptom:** User A sends User B a message. User B's sidebar doesn't update
and the message doesn't appear, until B manually searches for A and opens
the conversation — at which point the message shows up (from history).

**Root cause:** The server only delivered live events (`message:new`,
`conversation:updated`) to a Socket.IO room scoped to that specific
conversation, and a client only joined that room when they actively opened
the chat. A recipient who had never opened the conversation was never in
its room, so the server's broadcast had nowhere to go for them. The sidebar
update logic compounded this — it only patched *existing* entries in the
recipient's conversation list, so even if the event had arrived, a
brand-new conversation would never appear.

**Fix:** Redesigned delivery around a room scoped to *each user* (joined
once, automatically, on connect) instead of a room scoped to each
conversation. Every event for a user — whether or not they currently have
that conversation open — now goes to their personal room, and the
client-side handler upserts (adds or updates) the sidebar entry instead of
only updating existing ones.

## 6. The above fix still didn't work — cross-pod broadcast was silently failing

**Symptom:** After the fix above, a scripted test simulating two users
still showed the recipient receiving nothing, even though the new
architecture should have worked.

**Root cause:** Socket.IO's default room/broadcast state is per-process,
in-memory only. With 2 backend replicas, User A's and User B's sockets
often land on *different* pods (each pinned by their own independent
sticky-session cookie). `io.to(userRoom).emit(...)` running on pod A has no
way to know a socket for that room exists on pod B — the event just
vanishes. This had likely never worked reliably; it depended on both users
coincidentally landing on the same pod.

**Fix:** Added a Redis pub/sub adapter (`@socket.io/redis-adapter`) so every
backend pod broadcasts through Redis instead of only to its own local
sockets. Verified with a scripted test connecting as two users, forcing
them onto different pods, and confirming delivery — see
[docs/ARCHITECTURE.md](ARCHITECTURE.md#why-redis) for the full rationale.

---

# AWS EKS-specific issues

Everything below only applies to deploying on the `aws-eks` branch — none
of this came up locally.

## 7. `kubectl` commands fail with `Forbidden`, even though AWS credentials work

**Symptom:** `aws sts get-caller-identity` succeeds, `aws eks
update-kubeconfig` succeeds, but `kubectl get nodes` fails with `nodes is
forbidden: User "arn:...:user/aws-cli" cannot list resource "nodes"`.

**Root cause:** IAM authentication and Kubernetes RBAC authorization are
two separate systems. Having valid AWS credentials only proves *who* you
are to the cluster's API server — it says nothing about *what* you're
allowed to do inside Kubernetes. That mapping is controlled by the
cluster's **access entries** (EKS console → cluster → Access tab), not by
IAM policies.

**Fix:** Added an access entry for the IAM user, with the
`AmazonEKSClusterAdminPolicy` access policy, scoped to the whole cluster.

## 8. Mongo's PVC stuck `Pending` — storage class provisioner not supported

**Symptom:** `mongo-0` never scheduled. Auto Mode's compute controller
logged: `failed to validate pvc, provisioner is not supported
(...StorageClass=gp2)`.

**Root cause:** The default `gp2` StorageClass that ships on the cluster
uses the legacy in-tree provisioner (`kubernetes.io/aws-ebs`). EKS Auto
Mode only supports EBS CSI provisioning, not the old in-tree path.

**Fix:** Created a new StorageClass (`k8s/eks/storageclass.yaml`) using a
CSI provisioner instead, and pointed Mongo's `storageClassName` at it.

## 9. ...and then the *new* storage class also got stuck `Pending`

**Symptom:** After fixing #8, the PVC was still stuck, now with:
`Waiting for a volume to be created either by the external provisioner
'ebs.csi.aws.com' or manually by the system administrator` — forever.

**Root cause:** Guessed the wrong provisioner name. `ebs.csi.aws.com` is
the name used by the separately-installed community **AWS EBS CSI Driver**
add-on. EKS Auto Mode ships its *own* built-in EBS CSI driver, registered
under a different name entirely.

**Fix:** Ran `kubectl get csidrivers` to see what was actually registered
on this cluster — `ebs.csi.eks.amazonaws.com` — and used that name in the
StorageClass instead. Since `provisioner` is immutable on an existing
StorageClass object, this required deleting and recreating it (and the
PVC/pod that referenced it), not just editing it.

## 10. Backend/frontend pods: `ErrImagePull: no match for platform in manifest`

**Symptom:** Pods scheduled onto a node fine, then failed to start with a
platform mismatch error on the image manifest.

**Root cause:** The images were built on an Apple Silicon (arm64) Mac.
`docker build` defaults to the host's native architecture, so the pushed
images were arm64-only. The EKS Auto Mode nodes are Intel/AMD64
(`c7i-flex.large`) — an architecture the image manifest had no variant for.

**Fix:** Rebuilt with `docker buildx build --platform linux/amd64 --push`
instead of a plain `docker build` + separate tag/push.

## 11. ALB never gets an address — `couldn't auto-discover subnets`

**Symptom:** The Ingress stayed stuck with an empty `ADDRESS` column. `kubectl
describe ingress` showed: `Failed build model due to couldn't auto-discover
subnets: unable to resolve at least one subnet (0 match VPC and tags:
[kubernetes.io/role/elb])`.

**Root cause:** The ALB controller finds candidate subnets for the load
balancer by looking for a specific tag (`kubernetes.io/role/elb` for
internet-facing, `kubernetes.io/role/internal-elb` for internal). The
cluster's subnets — plain default-VPC subnets — had no tags at all.

**Fix:** Tagged the cluster's public subnets with
`kubernetes.io/role/elb=1` and `kubernetes.io/cluster/<name>=shared` via
`aws ec2 create-tags`. The ALB reconciled and got a real address within
about a minute of the tags landing.
