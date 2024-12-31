import { getFormatter } from "$lib/i18n";
import { SSEvents } from "$lib/schema";
import { patchItem } from "$lib/server/api-common";
import { getConfig } from "$lib/server/config";
import { itemEmitter } from "$lib/server/events/emitters";
import { getActiveMembership } from "$lib/server/group-membership";
import { tryDeleteImage } from "$lib/server/image-util";
import { client } from "$lib/server/prisma";
import type { Prisma } from "@prisma/client";
import { error, type RequestHandler } from "@sveltejs/kit";
import assert from "assert";

const validateItem = async (itemId: string | undefined, locals: App.Locals, checkPublic = false) => {
    const $t = await getFormatter();
    if (!checkPublic && !locals.user) error(401, $t("errors.unauthenticated"));

    if (!itemId) {
        error(400, $t("errors.must-specify-an-item-to-delete"));
    } else if (isNaN(parseInt(itemId))) {
        error(400, $t("errors.item-id-must-be-a-number"));
    }

    const item = await client.item.findUnique({
        where: {
            id: parseInt(itemId)
        },
        select: {
            addedBy: {
                select: {
                    username: true
                }
            },
            user: {
                select: {
                    username: true,
                    id: true
                }
            },
            group: {
                select: {
                    id: true
                }
            },
            lists: {
                select: {
                    public: true
                }
            },
            imageUrl: true
        }
    });

    if (!item) {
        error(404, $t("errors.item-not-found"));
    }

    if (checkPublic) {
        const onPublicList = item.lists.reduce((c, v) => c || v.public, false);
        if (!locals.user && onPublicList) {
            return item;
        } else {
            error(401, $t("errors.not-authorized"));
        }
    }

    return item;
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
    const $t = await getFormatter();
    const foundItem = await validateItem(params?.itemId, locals);
    assert(locals.user);
    assert(params.itemId);

    const activeMembership = await getActiveMembership(locals.user);
    const config = await getConfig(activeMembership.groupId);

    let suggestionDenied = false;
    const suggestionMethod = config.suggestions.method;
    if (foundItem.user.username === locals.user.username && suggestionMethod !== "surprise") {
        suggestionDenied = true;
    }

    if (!suggestionDenied && foundItem.addedBy.username !== locals.user.username) {
        error(401, $t("errors.not-authorized"));
    }

    try {
        const item = await client.item.delete({
            where: {
                id: parseInt(params.itemId)
            },
            select: {
                id: true,
                groupId: true,
                userId: true,
                addedBy: {
                    select: {
                        username: true
                    }
                },
                lists: {
                    select: {
                        id: true
                    }
                },
                imageUrl: true
            }
        });

        itemEmitter.emit(SSEvents.item.delete, item);

        if (item.imageUrl) {
            await tryDeleteImage(item.imageUrl);
        }

        return new Response(JSON.stringify(item), { status: 200 });
    } catch {
        error(404, $t("errors.item-not-found"));
    }
};

export const PATCH: RequestHandler = async ({ params, locals, request }) => {
    const $t = await getFormatter();
    const body = (await request.json()) as Record<string, unknown>;
    const item = await validateItem(params?.itemId, locals, body.publicPledgedById !== undefined);

    const { data, deleteOldImage } = patchItem(body);

    try {
        delete data.id;
        const updatedItem = await client.item.update({
            where: {
                id: parseInt(params.itemId!)
            },
            include: {
                addedBy: {
                    select: {
                        username: true,
                        name: true
                    }
                },
                pledgedBy: {
                    select: {
                        username: true,
                        name: true
                    }
                },
                publicPledgedBy: {
                    select: {
                        username: true,
                        name: true
                    }
                },
                user: {
                    select: {
                        username: true,
                        name: true
                    }
                },
                lists: {
                    select: {
                        id: true
                    }
                },
                itemPrice: true
            },
            data: data as Prisma.ItemUpdateInput
        });

        if (deleteOldImage && item.imageUrl) {
            await tryDeleteImage(item.imageUrl);
        }

        itemEmitter.emit(SSEvents.item.update, updatedItem);

        return new Response(JSON.stringify(updatedItem), { status: 200 });
    } catch {
        error(404, $t("errors.item-not-found"));
    }
};
