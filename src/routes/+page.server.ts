import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

import { client } from "$lib/server/prisma";
import { getActiveMembership } from "$lib/server/group-membership";

export const load = (async ({ locals }) => {
    const session = await locals.validate();
    if (!session) {
        redirect(302, `/login`);
    }
    const user = session.user;

    const activeMembership = await getActiveMembership(user);

    const userQuery = client.user.findUniqueOrThrow({
        select: {
            name: true,
            username: true,
            picture: true,
            items: {
                select: {
                    id: true
                },
                where: {
                    addedBy: {
                        username: user.username
                    },
                    groupId: activeMembership.groupId
                }
            },
            _count: {
                select: {
                    items: {
                        where: {
                            approved: false,
                            groupId: activeMembership.groupId
                        }
                    }
                }
            }
        },
        where: {
            username: user.username
        }
    });

    const usersQuery = client.user.findMany({
        where: {
            username: {
                not: user.username
            },
            UserGroupMembership: {
                some: {
                    group: {
                        id: activeMembership.groupId
                    }
                }
            }
        },
        select: {
            id: true,
            username: true,
            name: true,
            picture: true,
            items: {
                select: {
                    id: true
                },
                where: {
                    groupId: activeMembership.groupId
                }
            },
            _count: {
                select: {
                    items: {
                        where: {
                            pledgedById: {
                                not: null
                            },
                            approved: true,
                            groupId: activeMembership.groupId
                        }
                    }
                }
            }
        }
    });

    const [me, users] = await Promise.all([userQuery, usersQuery]);

    return {
        me,
        users,
        luciaUser: user,
        groupId: activeMembership.groupId
    };
}) satisfies PageServerLoad;
