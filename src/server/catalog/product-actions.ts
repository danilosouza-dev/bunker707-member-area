"use server";

// Server Actions do produto (docs/17 §1.6.2, §1.6.3, §1.6.5 e §1.6.6). Toda acao passa por
// runAdminAction (papel + zod + erro como ActionResult), grava so a linha do produto (e a sua linha de
// content_page_settings), confere updated_at quando o contrato pede e invalida o cache do catalogo.

import type { ActionResult } from "@/lib/action-result";
import { runAdminAction } from "@/server/actions/run-action";
import { invalidateCatalog } from "@/server/catalog/cache";
import { deleteContentItem } from "@/server/db/platform-store";
import { CatalogNotFoundError, CatalogRuleError } from "./errors";
import { persistProductImage } from "./images";
import {
  PRODUCT_COLUMNS,
  customPurchaseLabelOf,
  productFormatOf,
  productHrefFor,
  type ProductRow,
  type ProductSettings
} from "./mappers";
import {
  PRODUCT_FORMAT_LABELS,
  audienceFromColumns,
  bucketForProduct,
  idPrefixForProduct,
  kindForFormat,
  makeCatalogId,
  releasePhraseToRule
} from "./model";
import { evaluateChecklistFor, getPublishChecklist, headerForRow } from "./queries";
import {
  FORMATION_INVALID,
  accessColumnsFor,
  assertCanDeleteProduct,
  assertFormatChange,
  relabelForFormat,
  sortOrderAtEnd,
  sortOrderAtTop
} from "./rules";
import {
  createProductSchema,
  deleteProductSchema,
  productIdInputSchema,
  publishProductSchema,
  renameProductSchema,
  setProductImageSchema,
  setProductSituationSchema,
  updateProductAccessSchema,
  updateProductDetailsSchema
} from "./schemas";
import {
  catalogDb,
  countActiveAccess,
  failOnError,
  fetchIncludedCourses,
  fetchProductRow,
  fetchProductSettings,
  patchProductSettings,
  requireProductRow,
  updateRowGuarded
} from "./store";
import type {
  CreatedProduct,
  CreateProductInput,
  DeleteProductInput,
  ProductImageSaved,
  ProductPublished,
  ProductSaved,
  PublishChecklist,
  PublishProductInput,
  RenameProductInput,
  SetProductImageInput,
  SetProductSituationInput,
  UpdateProductAccessInput,
  UpdateProductDetailsInput
} from "./types";

const PRODUCT_NOT_FOUND = "Não encontramos este produto. Ele pode ter sido excluído.";

/** Formatos que aceitam "Como abre" e "Ao clicar quando bloqueado" (mesma regra do legado). */
function supportsPresentationSettings(kind: string) {
  return kind !== "Formacao";
}

/** [catalog.write] Cria em Rascunho e devolve o endereco da aba Conteúdo. */
export async function createProduct(input: CreateProductInput): Promise<ActionResult<CreatedProduct>> {
  return runAdminAction("catalog.write", createProductSchema, input, async ({ input: data }) => {
    const db = catalogDb();
    const parent = data.parentFormationId ? await fetchProductRow(data.parentFormationId, db) : null;

    if (data.parentFormationId && (!parent || productFormatOf(parent) !== "formacao")) {
      throw new CatalogRuleError(FORMATION_INVALID);
    }

    const scope = parent ? "included_content" : "sellable_product";
    const id = makeCatalogId(idPrefixForProduct(data.format, scope), data.title);
    const bucket = bucketForProduct(data.format, scope);
    let sortOrder: number;

    if (parent) {
      const { courses } = await fetchIncludedCourses(parent.id, db);
      sortOrder = sortOrderAtEnd(courses.length ? Math.max(...courses.map((course) => course.sort_order)) : null);
    } else {
      const { data: first, error } = await db
        .from("content_items")
        .select("sort_order")
        .eq("bucket", bucket)
        .order("sort_order", { ascending: true })
        .limit(1)
        .maybeSingle();
      failOnError(error, "Ordem do produto novo");
      sortOrder = sortOrderAtTop((first as { sort_order: number } | null)?.sort_order);
    }

    const coverUrl = await persistProductImage("cover", id, data.cover ?? null, "cover");
    const formatLabel = PRODUCT_FORMAT_LABELS[data.format];
    const access = accessColumnsFor({ audience: data.audience, purchaseUrl: data.purchaseUrl });
    const { error: insertError } = await db.from("content_items").insert({
      ...access,
      access_label: formatLabel,
      bucket,
      commerce_scope: scope,
      description: data.shortDescription || null,
      eyebrow: formatLabel,
      id,
      image: coverUrl ?? "",
      kind: kindForFormat(data.format),
      lessons_label: "0 aulas",
      max_students: null,
      progress: 0,
      publication_status: "draft",
      purchase_target: "same_tab",
      purchase_url: data.purchaseUrl,
      release_rule: null,
      sort_order: sortOrder,
      title: data.title
    });
    failOnError(insertError, "Criando produto");

    if (parent) {
      const { error } = await db
        .from("content_page_settings")
        .insert({ content_id: id, settings: { parentFormationId: parent.id } });

      if (error) {
        // Sem o vinculo, o curso ficaria solto e invisivel na lista; desfaz a criacao.
        await db.from("content_items").delete().eq("id", id);
        failOnError(error, "Vinculando curso a formacao");
      }
    }

    invalidateCatalog({ from: "action" });

    return { href: productHrefFor(id), id };
  });
}

/** [catalog.write] Nome editavel no cabecalho (autosave com updated_at). */
export async function renameProduct(input: RenameProductInput): Promise<ActionResult<ProductSaved>> {
  return runAdminAction("catalog.write", renameProductSchema, input, async ({ input: data }) => {
    const row = await updateRowGuarded<ProductRow>({
      columns: PRODUCT_COLUMNS,
      expectedUpdatedAt: data.expectedUpdatedAt,
      id: data.id,
      notFoundMessage: PRODUCT_NOT_FOUND,
      patch: { title: data.title },
      table: "content_items"
    });

    invalidateCatalog({ from: "action" });

    return { header: await headerForRow(row) };
  });
}

/** [catalog.write] Aba Detalhes. */
export async function updateProductDetails(input: UpdateProductDetailsInput): Promise<ActionResult<ProductSaved>> {
  return runAdminAction("catalog.write", updateProductDetailsSchema, input, async ({ input: data }) => {
    const db = catalogDb();
    const current = await requireProductRow(data.id, db);
    const currentFormat = productFormatOf(current);

    if (!currentFormat) {
      throw new CatalogNotFoundError(PRODUCT_NOT_FOUND);
    }

    const patch: Record<string, unknown> = {};

    if (data.title !== undefined) {
      patch.title = data.title;
    }

    if (data.shortDescription !== undefined) {
      patch.description = data.shortDescription || null;
    }

    if (data.level !== undefined) {
      patch.level_label = data.level?.trim() || null;
    }

    if (data.instructorName !== undefined) {
      const name = data.instructorName?.trim();
      patch.instructor = name ? { ...(current.instructor ?? {}), name } : null;
    }

    let nextKind = current.kind;

    if (data.format !== undefined) {
      const isIncludedCourse = current.commerce_scope === "included_content";
      const changes = assertFormatChange({
        activeAccessCount: data.format === currentFormat ? 0 : await countActiveAccess(current.id, db),
        current: currentFormat,
        isIncludedCourse,
        next: data.format
      });

      if (changes) {
        nextKind = kindForFormat(data.format);
        patch.kind = nextKind;
        patch.bucket = bucketForProduct(data.format, isIncludedCourse ? "included_content" : "sellable_product");
        patch.eyebrow = relabelForFormat(current.eyebrow, currentFormat, current.kind, data.format);
        patch.access_label = relabelForFormat(current.access_label, currentFormat, current.kind, data.format);
      }
    }

    const row = await updateRowGuarded<ProductRow>({
      columns: PRODUCT_COLUMNS,
      db,
      expectedUpdatedAt: data.expectedUpdatedAt,
      id: data.id,
      notFoundMessage: PRODUCT_NOT_FOUND,
      patch,
      table: "content_items"
    });

    if (nextKind !== current.kind) {
      const { error } = await db.from("course_modules").update({ owner_kind: nextKind }).eq("owner_id", row.id);
      failOnError(error, "Atualizando formato nos modulos");
    }

    const presentation = supportsPresentationSettings(row.kind);

    if (
      data.accent !== undefined ||
      (presentation && (data.coursePresentationMode !== undefined || data.lockedActionMode !== undefined))
    ) {
      const set: ProductSettings = {};

      if (data.accent !== undefined) {
        set.accent = data.accent;
      }

      if (presentation && data.coursePresentationMode !== undefined) {
        set.coursePresentationMode = data.coursePresentationMode;
      }

      if (presentation && data.lockedActionMode !== undefined) {
        set.lockedActionMode = data.lockedActionMode;
      }

      await patchProductSettings(row.id, { set }, db);
    }

    invalidateCatalog({ from: "action" });

    return { header: await headerForRow(row) };
  });
}

/** [catalog.write] Aba Acesso e venda. */
export async function updateProductAccess(input: UpdateProductAccessInput): Promise<ActionResult<ProductSaved>> {
  return runAdminAction("catalog.write", updateProductAccessSchema, input, async ({ input: data }) => {
    const db = catalogDb();
    const current = await requireProductRow(data.id, db);
    const audience = data.audience ?? audienceFromColumns({ accessModel: current.access_model, listing: current.listing });
    const purchaseUrl = data.purchaseUrl !== undefined ? data.purchaseUrl : current.purchase_url?.trim() || null;
    const purchaseLabel = data.purchaseLabel !== undefined
      ? data.purchaseLabel?.trim() || null
      : customPurchaseLabelOf(current.purchase_label);
    const patch: Record<string, unknown> = {
      ...accessColumnsFor({ audience, purchaseLabel, purchaseUrl }),
      purchase_url: purchaseUrl
    };

    if (data.purchaseTarget !== undefined) {
      patch.purchase_target = data.purchaseTarget;
    }

    if (data.maxStudents !== undefined) {
      patch.max_students = data.maxStudents ?? null;
    }

    if (data.release !== undefined) {
      patch.release_rule = releasePhraseToRule(data.release);
    }

    const row = await updateRowGuarded<ProductRow>({
      columns: PRODUCT_COLUMNS,
      db,
      expectedUpdatedAt: data.expectedUpdatedAt,
      id: data.id,
      notFoundMessage: PRODUCT_NOT_FOUND,
      patch,
      table: "content_items"
    });

    invalidateCatalog({ from: "action" });

    return { header: await headerForRow(row) };
  });
}

/** [catalog.write] Capa (720×1040) ou hero (1920×720) recortados no cliente em WebP; null remove. */
export async function setProductImage(input: SetProductImageInput): Promise<ActionResult<ProductImageSaved>> {
  return runAdminAction("catalog.write", setProductImageSchema, input, async ({ input: data }) => {
    const db = catalogDb();
    await requireProductRow(data.id, db);
    const url = await persistProductImage(data.slot, data.id, data.image, "image");

    if (data.slot === "hero") {
      if (!url) {
        await patchProductSettings(data.id, { unset: ["hero"] }, db);
      } else {
        // So a chave hero e regravada; o que mais houver nela (textos, visibilidade) e mantido.
        const settings = await fetchProductSettings(data.id, db);
        const currentHero = settings.hero && typeof settings.hero === "object" && !Array.isArray(settings.hero)
          ? (settings.hero as Record<string, unknown>)
          : {};
        const currentVisibility = currentHero.visibility && typeof currentHero.visibility === "object"
          ? (currentHero.visibility as Record<string, unknown>)
          : {};

        await patchProductSettings(data.id, {
          set: {
            hero: {
              ...currentHero,
              mediaSrc: url,
              mediaType: "image",
              visibility: { badge: false, cta: false, description: false, title: false, ...currentVisibility }
            }
          }
        }, db);
      }
    }

    // A capa mora na linha do produto; o hero, nas configuracoes. Nos dois casos a linha do produto e
    // tocada para o updated_at novo voltar a tela (o proximo "Salvar" confere contra ele).
    const row = await updateRowGuarded<{ updated_at: string }>({
      columns: "id,updated_at",
      db,
      id: data.id,
      notFoundMessage: PRODUCT_NOT_FOUND,
      patch: data.slot === "cover" ? { image: url ?? "" } : {},
      table: "content_items"
    });

    invalidateCatalog({ from: "action" });

    return { slot: data.slot, updatedAt: row.updated_at, url };
  });
}

/** [catalog.publish] Checklist atual, para o dialogo "Publicar" (leitura sob demanda). */
export async function loadPublishChecklist(input: { id: string }): Promise<ActionResult<PublishChecklist>> {
  return runAdminAction("catalog.publish", productIdInputSchema, input, async ({ input: data }) => {
    const checklist = await getPublishChecklist(data.id);

    if (!checklist) {
      throw new CatalogNotFoundError(PRODUCT_NOT_FOUND);
    }

    return checklist;
  });
}

/** [catalog.publish] Reavalia o checklist no servidor; com bloqueio devolve published: false. */
export async function publishProduct(input: PublishProductInput): Promise<ActionResult<ProductPublished>> {
  return runAdminAction("catalog.publish", publishProductSchema, input, async ({ input: data }) => {
    const db = catalogDb();
    const current = await requireProductRow(data.id, db);
    const checklist = await evaluateChecklistFor(current);

    if (!checklist) {
      throw new CatalogNotFoundError(PRODUCT_NOT_FOUND);
    }

    if (!checklist.canPublish) {
      return { checklist, header: await headerForRow(current), published: false };
    }

    const row = await updateRowGuarded<ProductRow>({
      columns: PRODUCT_COLUMNS,
      db,
      expectedUpdatedAt: data.expectedUpdatedAt,
      id: data.id,
      notFoundMessage: PRODUCT_NOT_FOUND,
      patch: { publication_status: "published" },
      table: "content_items"
    });

    if (productFormatOf(row) === "formacao") {
      // O aluno so acessa curso incluido publicado: publicar a formacao publica junto os cursos em rascunho.
      const { courses } = await fetchIncludedCourses(row.id, db);
      const draftIds = courses.filter((course) => course.publication_status === "draft").map((course) => course.id);

      if (draftIds.length > 0) {
        const { error } = await db.from("content_items").update({ publication_status: "published" }).in("id", draftIds);
        failOnError(error, "Publicando cursos da formacao");
      }
    }

    invalidateCatalog({ from: "action" });

    return { checklist, header: await headerForRow(row), published: true };
  });
}

/** [catalog.publish] Voltar para Rascunho ou Arquivar. */
export async function setProductSituation(input: SetProductSituationInput): Promise<ActionResult<ProductSaved>> {
  return runAdminAction("catalog.publish", setProductSituationSchema, input, async ({ input: data }) => {
    const row = await updateRowGuarded<ProductRow>({
      columns: PRODUCT_COLUMNS,
      expectedUpdatedAt: data.expectedUpdatedAt,
      id: data.id,
      notFoundMessage: PRODUCT_NOT_FOUND,
      patch: { publication_status: data.situation },
      table: "content_items"
    });

    invalidateCatalog({ from: "action" });

    return { header: await headerForRow(row) };
  });
}

/** [catalog.delete] Exclui de verdade (revoga acessos ligados); exige digitar o nome. */
export async function deleteProduct(input: DeleteProductInput): Promise<ActionResult<{ id: string }>> {
  return runAdminAction("catalog.delete", deleteProductSchema, input, async ({ input: data }) => {
    const row = await requireProductRow(data.id);
    const format = productFormatOf(row);

    if (!format) {
      throw new CatalogNotFoundError(PRODUCT_NOT_FOUND);
    }

    const includedCourses = format === "formacao" ? (await fetchIncludedCourses(row.id)).courses.length : 0;

    assertCanDeleteProduct({ confirmTitle: data.confirmTitle, format, includedCourses, title: row.title });

    // Reaproveita a exclusao do legado: apaga o produto (modulos e aulas em cascata), favoritos e
    // matriculas dele, revoga os acessos ativos e remove pacotes que ficariam vazios.
    await deleteContentItem(row.id);

    invalidateCatalog({ from: "action" });

    return { id: row.id };
  });
}
