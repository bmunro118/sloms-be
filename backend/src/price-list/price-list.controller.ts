import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
  ApiConsumes,
  ApiBody,
  ApiProduces,
  ApiParam,
} from "@nestjs/swagger";
import { Response, Request } from "express";
import {
  CurrentUser,
  CurrentUserPayload,
} from "../auth/decorators/current-user.decorator";
import { PriceListService } from "./price-list.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { Role } from "../users/entities/role.enum";

@ApiTags("price-list")
@ApiBearerAuth("access-token")
@Controller("price-list")
@UseGuards(JwtAuthGuard, RolesGuard)
export class PriceListController {
  constructor(private readonly priceListService: PriceListService) {}

  // ---------------------------------------------------------------------------
  // Revision management
  // ---------------------------------------------------------------------------

  /**
   * GET /price-list/revisions
   * Lists all revisions (draft, active, archived), newest first
   */
  @Get("revisions")
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: "List all price list revisions" })
  @ApiOkResponse({ description: "Array of revisions." })
  listRevisions() {
    return this.priceListService.listRevisions();
  }

  /**
   * GET /price-list/revisions/:id
   */
  @Get("revisions/:id")
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: "Get a specific revision" })
  @ApiParam({ name: "id", type: Number })
  getRevision(@Param("id", ParseIntPipe) id: number) {
    return this.priceListService.getRevision(id);
  }

  /**
   * POST /price-list/revisions/:id/activate
   * Activates a revision (archives the current active one).
   * Works for both promoting a draft and rolling back to an archived revision.
   */
  @Post("revisions/:id/activate")
  @Roles(Role.Manager, Role.Admin)
  @ApiOperation({
    summary: "Activate a revision — promotes a draft or rolls back to an archived one",
  })
  @ApiParam({ name: "id", type: Number })
  @ApiOkResponse({ description: "The newly activated revision." })
  activateRevision(@Param("id", ParseIntPipe) id: number) {
    return this.priceListService.activateRevision(id);
  }

  // ---------------------------------------------------------------------------
  // Price list queries
  // ---------------------------------------------------------------------------

  /**
   * GET /price-list/lists
   * Returns all active price list types
   */
  @Get("lists")
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: "Get all active price list types" })
  @ApiOkResponse({ description: "Array of price list types." })
  getListTypes() {
    return this.priceListService.getListTypes();
  }

  /**
   * GET /price-list/export
   * GET /price-list/export?revisionId=3
   */
  @Get("export")
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: "Export price list as CSV (defaults to active revision)" })
  @ApiProduces("text/csv")
  @ApiQuery({ name: "revisionId", required: false, type: Number })
  @ApiOkResponse({ description: "CSV file download." })
  async exportCsv(
    @Res() res: Response,
    @Query("revisionId") revisionId?: string,
  ) {
    const csv = await this.priceListService.exportCsv(
      revisionId ? parseInt(revisionId, 10) : undefined,
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="price-list-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(csv);
  }

  /**
   * POST /price-list/import
   * Creates a new draft revision from a CSV upload.
   * Activate it separately via POST /price-list/revisions/:id/activate
   */
  @Post("import")
  @Roles(Role.Admin, Role.Manager)
  @UseInterceptors(FileInterceptor("file"))
  @ApiOperation({ summary: "Import price list from CSV — creates a draft revision" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: { type: "string", format: "binary" },
      },
    },
  })
  @ApiQuery({ name: "name", required: false, type: String, description: "Revision name" })
  @ApiQuery({ name: "notes", required: false, type: String })
  @ApiQuery({ name: "dryRun", required: false, type: Boolean, description: "Validate and summarise without writing" })
  @ApiQuery({ name: "merge", required: false, type: Boolean, description: "Merge CSV into active revision rather than replacing" })
  @ApiOkResponse({ description: "Import summary. revision is null when dryRun=true." })
  importCsv(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
    @Query("name") name?: string,
    @Query("notes") notes?: string,
    @Query("dryRun") dryRun?: string,
    @Query("merge") merge?: string,
  ) {
    const user = req.user as { username?: string } | undefined;
    const revisionName =
      name?.trim() || `Import ${new Date().toISOString().slice(0, 10)}`;
    return this.priceListService.importCsv(
      file.buffer,
      revisionName,
      notes?.trim() || null,
      user?.username ?? null,
      dryRun === "true",
      merge === "true",
    );
  }

  /**
   * GET /price-list
   * GET /price-list?category=Hearing+Aid
   * GET /price-list?revisionId=3
   */
  @Get()
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: "List all price list items (defaults to active revision)" })
  @ApiQuery({ name: "category", required: false, type: String })
  @ApiQuery({ name: "revisionId", required: false, type: Number })
  @ApiOkResponse({ description: "Array of price list rows." })
  findAll(
    @Query("category") category?: string,
    @Query("revisionId") revisionId?: string,
  ) {
    const rid = revisionId ? parseInt(revisionId, 10) : undefined;
    if (category) {
      return this.priceListService.findByCategory(category, rid);
    }
    return this.priceListService.findAll(rid);
  }

  /**
   * DELETE /price-list/items/:itemId
   * Soft-deletes a price list item
   */
  @Delete("items/:itemId")
  @Roles(Role.Manager, Role.Admin)
  @ApiOperation({ summary: "Void (soft-delete) a price list item" })
  @ApiParam({ name: "itemId", type: String })
  @ApiOkResponse({ description: "The voided price list item." })
  voidItem(
    @CurrentUser() user: CurrentUserPayload,
    @Param("itemId") itemId: string,
  ) {
    return this.priceListService.voidItem(itemId, user.username);
  }

  /**
   * DELETE /price-list/lists/:id
   * Soft-deletes a price list type
   */
  @Delete("lists/:id")
  @Roles(Role.Manager, Role.Admin)
  @ApiOperation({ summary: "Void (soft-delete) a price list type" })
  @ApiParam({ name: "id", type: Number })
  @ApiOkResponse({ description: "The voided price list type." })
  voidListType(
    @CurrentUser() user: CurrentUserPayload,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.priceListService.voidListType(id, user.username);
  }

  /**
   * GET /price-list/:itemId
   */
  @Get(":itemId")
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: "Get a price list item by ID" })
  @ApiQuery({ name: "revisionId", required: false, type: Number })
  @ApiOkResponse({ description: "The requested price list item." })
  findOne(
    @Param("itemId") itemId: string,
    @Query("revisionId") revisionId?: string,
  ) {
    return this.priceListService.findOne(
      itemId,
      revisionId ? parseInt(revisionId, 10) : undefined,
    );
  }

  /**
   * GET /price-list/:itemId/lists
   */
  @Get(":itemId/lists")
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: "Get all prices for an item across all lists" })
  @ApiQuery({ name: "revisionId", required: false, type: Number })
  @ApiOkResponse({ description: "Item with all list prices." })
  getAllLists(
    @Param("itemId") itemId: string,
    @Query("revisionId") revisionId?: string,
  ) {
    return this.priceListService.getAllListsForItem(
      itemId,
      revisionId ? parseInt(revisionId, 10) : undefined,
    );
  }

  /**
   * GET /price-list/:itemId/lists/:listName
   */
  @Get(":itemId/lists/:listName")
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: "Get the price for an item in a specific list" })
  @ApiQuery({ name: "revisionId", required: false, type: Number })
  @ApiOkResponse({ description: "The price for the item in the given list." })
  getPriceForList(
    @Param("itemId") itemId: string,
    @Param("listName") listName: string,
    @Query("revisionId") revisionId?: string,
  ) {
    return this.priceListService.getPriceForList(
      itemId,
      listName,
      revisionId ? parseInt(revisionId, 10) : undefined,
    );
  }
}
