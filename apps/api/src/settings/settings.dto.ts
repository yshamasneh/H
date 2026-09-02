import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

export class UpdatePlatformSettingsDto {
  @ApiProperty({
    example: true,
    description: "When false, customers cannot request 'no substitution' at checkout."
  })
  @IsBoolean()
  substitutionOptionEnabled!: boolean;
}
