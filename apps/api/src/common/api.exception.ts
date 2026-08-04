import { HttpException } from "@nestjs/common";

export class ApiException extends HttpException {
  constructor(
    statusCode: number,
    code: string,
    message: string,
    details: unknown = null
  ) {
    super({ statusCode, code, message, details }, statusCode);
  }
}
