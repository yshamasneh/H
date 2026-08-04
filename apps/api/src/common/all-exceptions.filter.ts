import { randomUUID } from "node:crypto";
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger
} from "@nestjs/common";
import type { Request, Response } from "express";

type ErrorBody = {
  statusCode: number;
  code: string;
  message: string;
  details: unknown;
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const requestId = readRequestId(request);
    const body = this.toBody(exception);

    if (body.statusCode >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    response.setHeader("x-request-id", requestId);
    response.status(body.statusCode).json({ ...body, requestId });
  }

  private toBody(exception: unknown): ErrorBody {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (response && typeof response === "object") {
        const candidate = response as Partial<ErrorBody> & { message?: string | string[] };
        return {
          statusCode: exception.getStatus(),
          code: typeof candidate.code === "string" ? candidate.code : "HTTP_ERROR",
          message: Array.isArray(candidate.message)
            ? candidate.message.join(" ")
            : candidate.message ?? "Request failed.",
          details: candidate.details ?? null
        };
      }
      return {
        statusCode: exception.getStatus(),
        code: "HTTP_ERROR",
        message: String(response),
        details: null
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected server error occurred.",
      details: null
    };
  }
}

function readRequestId(request: Request): string {
  const value = request.header("x-request-id");
  return value && value.length <= 128 ? value : randomUUID();
}
