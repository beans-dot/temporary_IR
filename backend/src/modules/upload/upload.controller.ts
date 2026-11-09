import {
  BadRequestException,
  Controller,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('excel')
  @UseInterceptors(FileInterceptor('file'))
  async uploadExcel(
    @UploadedFile() file: Express.Multer.File,
    @Query('overwriteExisting') overwriteExisting?: string,
    @Query('confirmLocked') confirmLocked?: string,
    @Query('sourceType') sourceType?: string,
  ) {
    if (!file) {
      throw new BadRequestException('업로드된 파일이 없습니다.');
    }
    return this.uploadService.processUpload(file.buffer, {
      filename: file.originalname,
      overwriteExisting: overwriteExisting === 'true',
      confirmLocked: confirmLocked === 'true',
      sourceType:
        sourceType === 'MONITORING'
          ? 'MONITORING'
          : sourceType === 'INTERNAL'
            ? 'INTERNAL'
            : undefined,
    });
  }
}
