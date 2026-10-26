# k8s

Manifiestos de Kubernetes (Minikube o kind), namespace `tcg-store`.

- Un Deployment + Service (ClusterIP) por componente.
- Ingress para frontend y BFF.
- MongoDB, PostgreSQL, Redis y RabbitMQ se instalan con Helm.
- Secrets para la API key de Claude y credenciales; ConfigMaps para URLs internas.

```bash
kubectl apply -f k8s/namespace.yaml
```
