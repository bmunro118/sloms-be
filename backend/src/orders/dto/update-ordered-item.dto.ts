import { PartialType } from "@nestjs/mapped-types";
import { CreateOrderedItemDto } from "./create-ordered-item.dto";

export class UpdateOrderedItemDto extends PartialType(CreateOrderedItemDto) {}
