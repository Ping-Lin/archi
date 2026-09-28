{{- define "enterprise.name" -}}
{{- printf "%s-workload" .Release.Name -}}
{{- end -}}
{{- define "enterprise.endpoint" -}}
{{- printf "%s-endpoint" .Release.Name -}}
{{- end -}}
