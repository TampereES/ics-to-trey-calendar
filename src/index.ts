import "dotenv/config";
import ical from "node-ical";

const getLumaCalendar = async () => {
  const cal = await ical.async.fromURL(
    "https://api.lu.ma/ics/get?entity=calendar&id=cal-ixj8cqeAEnPgo9o"
  );

  const events = Object.values(cal).filter(
    (i) =>
      i.type === "VEVENT" &&
      i.start.getTime() > new Date().getTime() - 24 * 60 * 60 * 1000
  ) as ical.VEvent[];

  return events;
};

const authenticate = async () => {
  const res = await fetch(
    "https://trey-calendar-strapi.fly.dev/api/auth/local",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        identifier: process.env.TREY_USER,
        password: process.env.TREY_PASSWORD,
      }),
    }
  );

  const json = (await res.json()) as any;

  console.log("Authenticated as", json.user.username);

  return json.jwt as string;
};

let authHeader: string | null = null;

const getAuthorizationHeader = async () => {
  if (!authHeader) {
    authHeader = `Bearer ${await authenticate()}`;
  }

  return authHeader;
};

const createEvent = async (
  name: string,
  from: Date,
  to: Date,
  location: string,
  description: string
) => {
  const res = await fetch(
    "https://trey-calendar-strapi.fly.dev/api/events?fields=createdAt&fields=updatedAt&fields=from&fields=to&fields=location&populate[name]=true&populate[description]=true&populate[image][fields]=url&populate[image][fields]=alternativeText&populate[category][fields]=id&populate[organizer][fields]=id",
    {
      method: "POST",
      headers: {
        Authorization: await getAuthorizationHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: {
          name: {
            fi: name,
            en: name,
          },
          from: from.toISOString(),
          to: to.toISOString(),
          location: location,
          description: {
            fi: description,
            en: description,
          },
          category: null,
          isOpen: true,
          image: null,
        },
      }),
    }
  );

  if (res.status === 200) {
    console.log(`Created event "${name}"`);
  } else {
    throw Error("Failed to create event:" + (await res.json()));
  }
};

const editEvent = async (
  id: number,
  name: string,
  nameId: number,
  from: Date,
  to: Date,
  location: string,
  description: string,
  descriptionId: number
) => {
  const res = await fetch(
    `https://trey-calendar-strapi.fly.dev/api/events/${id}?fields=createdAt&fields=updatedAt&fields=from&fields=to&fields=location&populate[name]=true&populate[description]=true&populate[image][fields]=url&populate[image][fields]=alternativeText&populate[category][fields]=id&populate[organizer][fields]=id`,
    {
      method: "PUT",
      headers: {
        Authorization: await getAuthorizationHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: {
          name: {
            id: nameId,
            fi: name,
            en: name,
          },
          from: from.toISOString(),
          to: to.toISOString(),
          location: location,
          description: {
            id: descriptionId,
            fi: description,
            en: description,
          },
          category: null,
          isOpen: true,
          image: null,
        },
      }),
    }
  );

  if (res.status === 200) {
    console.log(`Edited event "${name}" with id ${id}`);
  } else {
    throw Error(`Failed to edit event id ${id}: ${await res.json()}`);
  }
};

const deleteEvent = async (id: number) => {
  const res = await fetch(
    `https://trey-calendar-strapi.fly.dev/api/events/${id}`,
    {
      method: "DELETE",
      headers: {
        Authorization: await getAuthorizationHeader(),
      },
    }
  );

  if (res.status === 200) {
    console.log(`Deleted event id ${id}`);
  } else {
    throw Error(`Failed to delete event id ${id}: ${await res.json()}`);
  }
};

const getEvents = async () => {
  const getEventsPage = async (page: number) => {
    return await fetch(
      `https://trey-calendar-strapi.fly.dev/api/events?fields=from&fields=to&fields=location&populate[name]=true&populate[description]=true&populate[category][fields]=id&populate[organizer][fields]=id&filters[organizer][id][$eq]=31&sort=from:desc&pagination[page]=${page}&pagination[pageSize]=10`,
      {
        method: "GET",
        headers: {
          Authorization: await getAuthorizationHeader(),
        },
      }
    );
  };

  let page = 1;
  let data = [] as {
    id: number;
    attributes: {
      from: string;
      to: string;
      location: string;
      name: {
        id: number;
        fi: string;
        en: string;
      };
      description: {
        id: number;
        fi: string;
        en: string;
      };
      category: { data: null };
      organizer: {
        data: {
          id: number;
          attributes: {
            bgColor: string;
            fgColor: string;
            createdAt: string;
            updatedAt: string;
          };
        };
      };
    };
  }[];

  while (true) {
    const res = await getEventsPage(page);
    const json: any = await res.json();

    data.push(...json.data);

    if (json.meta.pagination.pageCount > page) {
      page++;
    } else {
      break;
    }
  }

  return data;
};

const main = async () => {
  const lumaEvents = await getLumaCalendar();
  const treyEvents = await getEvents();

  // Filter

  const newEvents = lumaEvents.filter(
    (e) =>
      !treyEvents
        .map((te) => te.attributes.description.fi)
        .includes(e.description)
  );

  const existingEvents = lumaEvents.filter((e) =>
    treyEvents.map((te) => te.attributes.description.fi).includes(e.description)
  );

  const deletedEvents = treyEvents.filter(
    (e) =>
      !lumaEvents
        .map((le) => le.description)
        .includes(e.attributes.description.fi)
  );

  // Execute

  for (const event of newEvents) {
    await createEvent(
      event.summary,
      event.start,
      event.end,
      event.location,
      event.description
    );
  }

  for (const event of existingEvents) {
    const treyEvent = treyEvents.find(
      (e) => e.attributes.description.fi === event.description
    );

    if (!treyEvent) {
      throw new Error("Cannot happen");
    }

    if (
      event.summary === treyEvent.attributes.name.fi &&
      event.start.getTime() === new Date(treyEvent.attributes.from).getTime() &&
      event.end.getTime() === new Date(treyEvent.attributes.to).getTime() &&
      event.location === treyEvent.attributes.location &&
      event.description === treyEvent.attributes.description.fi
    ) {
      // Hasn't changed
      continue;
    }

    await editEvent(
      treyEvent.id,
      event.summary,
      treyEvent.attributes.name.id,
      event.start,
      event.end,
      event.location,
      event.description,
      treyEvent.attributes.description.id
    );
  }

  for (const event of deletedEvents) {
    await deleteEvent(event.id);
  }
};

main();
