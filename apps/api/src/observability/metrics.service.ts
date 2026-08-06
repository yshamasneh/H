import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class MetricsService {
  private readonly startedAt = Date.now();
  private readonly counts = new Map<string, number>();
  private readonly durationsMs = new Map<string, number>();
  private inFlight = 0;

  constructor(private readonly config: ConfigService) {}

  requestStarted(): void {
    this.inFlight += 1;
  }

  requestFinished(method: string, statusCode: number, durationMs: number): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const key = `${method.toUpperCase()}|${Math.floor(statusCode / 100)}xx`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    this.durationsMs.set(key, (this.durationsMs.get(key) ?? 0) + durationMs);
  }

  renderPrometheus(): string {
    const lines = [
      "# HELP tasawaq_http_requests_total Total completed HTTP requests.",
      "# TYPE tasawaq_http_requests_total counter"
    ];
    for (const [key, value] of [...this.counts.entries()].sort()) {
      const [method, statusClass] = key.split("|");
      lines.push(`tasawaq_http_requests_total{method="${method}",status_class="${statusClass}"} ${value}`);
    }
    lines.push("# HELP tasawaq_http_request_duration_milliseconds_sum Cumulative HTTP request duration.");
    lines.push("# TYPE tasawaq_http_request_duration_milliseconds_sum counter");
    for (const [key, value] of [...this.durationsMs.entries()].sort()) {
      const [method, statusClass] = key.split("|");
      lines.push(`tasawaq_http_request_duration_milliseconds_sum{method="${method}",status_class="${statusClass}"} ${value.toFixed(3)}`);
    }
    lines.push("# HELP tasawaq_http_requests_in_flight Current HTTP requests in flight.");
    lines.push("# TYPE tasawaq_http_requests_in_flight gauge");
    lines.push(`tasawaq_http_requests_in_flight ${this.inFlight}`);
    lines.push("# HELP tasawaq_process_uptime_seconds Process uptime in seconds.");
    lines.push("# TYPE tasawaq_process_uptime_seconds gauge");
    lines.push(`tasawaq_process_uptime_seconds ${Math.floor((Date.now() - this.startedAt) / 1_000)}`);
    lines.push("# HELP tasawaq_build_info Build and environment metadata.");
    lines.push("# TYPE tasawaq_build_info gauge");
    lines.push(
      `tasawaq_build_info{version="${escapeLabel(this.config.get<string>("APP_VERSION", "development"))}",environment="${escapeLabel(this.config.get<string>("NODE_ENV", "development"))}"} 1`
    );
    return `${lines.join("\n")}\n`;
  }
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
