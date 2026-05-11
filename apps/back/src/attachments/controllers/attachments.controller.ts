import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseFilePipeBuilder,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Attachment as AttachmentResponse } from '@tikora/core';
import { ATTACHMENT_MAX_SIZE_BYTES } from '@tikora/core';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { AttachmentsService } from '../services/attachments.service';

// Tipo del file de multer (no exportamos `Express.Multer.File` para no
// inflar la API; lo declaramos local).
interface UploadedAttachment {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@ApiTags('Attachments')
@ApiBearerAuth('bearer')
@Controller('tickets/:ticketId/attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      // memoryStorage permite hashear y validar antes de tocar el FS;
      // los binarios de hasta 10 MB caben sin problema en RAM.
      storage: memoryStorage(),
      limits: { fileSize: ATTACHMENT_MAX_SIZE_BYTES, files: 1 },
    }),
  )
  async upload(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('ticketId') ticketId: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({
        fileIsRequired: true,
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
      }),
    )
    file: UploadedAttachment,
  ): Promise<AttachmentResponse> {
    return this.attachments.upload(caller, ticketId, {
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    });
  }

  @Get(':id')
  @Header('Cache-Control', 'private, max-age=0, must-revalidate')
  async download(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('ticketId') ticketId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, attachment } = await this.attachments.download(caller, ticketId, id);
    // Headers según `tikora-api.md` §8.1.
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Length', attachment.sizeBytes);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${this.sanitizeFilename(attachment.originalName)}"`,
    );
    return new StreamableFile(stream);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('ticketId') ticketId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.attachments.delete(caller, ticketId, id);
  }

  /**
   * Filtra caracteres que rompen el `Content-Disposition` (CR/LF/quote)
   * para evitar inyección de headers. Los nombres ya están limitados por
   * el filesystem origen, pero defensivo.
   */
  private sanitizeFilename(name: string): string {
    return name.replace(/["\r\n]/g, '_');
  }
}
