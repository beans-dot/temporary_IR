import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateExportLogDto {
  @IsIn(['xlsx', 'png', 'pdf', 'json'])
  format: 'xlsx' | 'png' | 'pdf' | 'json';

  @IsString()
  @MaxLength(100)
  source: string;

  @IsString()
  @MaxLength(300)
  filename: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  summary?: string;
}
