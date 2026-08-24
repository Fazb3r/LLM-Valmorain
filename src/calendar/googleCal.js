const { google } = require('googleapis');
require('dotenv').config();

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'urn:ietf:wg:oauth:2.0:oob'
);

// Optional: Set credentials if refresh token is provided in .env
if (process.env.GOOGLE_REFRESH_TOKEN) {
    oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });
}

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

async function createCalendarEvent(summary, start_time, end_time, description = '') {
    if (!process.env.GOOGLE_REFRESH_TOKEN) {
        return { error: "Google Calendar not authenticated. The VIP needs to generate a refresh token and store it in .env." };
    }

    try {
        const event = {
            summary: summary,
            description: description,
            start: {
                dateTime: start_time, // Expected ISO 8601
            },
            end: {
                dateTime: end_time, // Expected ISO 8601
            },
        };

        const response = await calendar.events.insert({
            calendarId: 'primary',
            resource: event,
        });

        return { success: true, link: response.data.htmlLink, event_id: response.data.id };
    } catch (error) {
        return { error: error.message };
    }
}

async function getUpcomingEvents(time_window_days = 7) {
    if (!process.env.GOOGLE_REFRESH_TOKEN) {
        return { error: "Google Calendar not authenticated. The VIP needs to generate a refresh token and store it in .env." };
    }

    try {
        const timeMinDate = new Date();
        const timeMaxDate = new Date();
        timeMaxDate.setDate(timeMaxDate.getDate() + time_window_days);

        const calendarListRes = await calendar.calendarList.list();
        const calendars = calendarListRes.data.items;
        
        let allEvents = [];

        for (const cal of calendars) {
            try {
                const response = await calendar.events.list({
                    calendarId: cal.id,
                    timeMin: timeMinDate.toISOString(),
                    timeMax: timeMaxDate.toISOString(),
                    maxResults: 15,
                    singleEvents: true,
                    orderBy: 'startTime',
                });

                if (response.data.items) {
                    const mappedEvents = response.data.items.map(event => ({
                        summary: event.summary,
                        start: event.start.dateTime || event.start.date,
                        end: event.end.dateTime || event.end.date,
                        description: event.description || '',
                        calendar_name: cal.summary
                    }));
                    allEvents = allEvents.concat(mappedEvents);
                }
            } catch (e) {
                // Ignore individual calendar errors
            }
        }

        allEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
        allEvents = allEvents.slice(0, 20); // Limit to top 20 to avoid overwhelming LLM

        if (allEvents.length === 0) {
            return { message: "No upcoming events found across all calendars." };
        }

        return allEvents;
    } catch (error) {
        return { error: error.message };
    }
}

function getAuthUrl() {
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/calendar'],
    });
}

async function getTokens(code) {
    const { tokens } = await oauth2Client.getToken(code);
    return tokens;
}

module.exports = { createCalendarEvent, getUpcomingEvents, getAuthUrl, getTokens };
