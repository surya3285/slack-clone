{{- define "slack-clone.labels" -}}
app.kubernetes.io/part-of: slack-clone
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
