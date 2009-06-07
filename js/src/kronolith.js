/**
 * kronolith.js - Base application logic.
 * NOTE: ContextSensitive.js must be loaded before this file.
 *
 * Copyright 2008-2009 The Horde Project (http://www.horde.org/)
 *
 * See the enclosed file COPYING for license information (GPL). If you
 * did not receive this file, see http://www.fsf.org/copyleft/gpl.html.
 *
 * @author Jan Schneider <jan@horde.org>
 */

/* Trick some Horde js into thinking this is the parent Horde window. */
var frames = { horde_main: true },

/* Kronolith object. */
KronolithCore = {
    // Vars used and defaulting to null/false:
    //   DMenu, Growler, inAjaxCallback, is_logout, onDoActionComplete,
    //   eventForm, daySizes, viewLoading

    view: '',
    ecache: $H(),
    efifo: {},
    eventsLoading: $H(),
    loading: 0,
    date: new Date(),

    doActionOpts: {
        onException: function(r, e) { KronolitCore.debug('onException', e); },
        onFailure: function(t, o) { KronolithCore.debug('onFailure', t); },
        evalJS: false,
        evalJSON: true
    },

    debug: function(label, e)
    {
        if (!this.is_logout && Kronolith.conf.debug) {
            alert(label + ': ' + (e instanceof Error ? e.name + '-' + e.message : Object.inspect(e)));
        }
    },

    /* 'action' -> if action begins with a '*', the exact string will be used
     *  instead of sending the action to the ajax handler. */
    doAction: function(action, params, callback, opts)
    {
        var b, tmp = {};

        opts = Object.extend(this.doActionOpts, opts || {});
        params = $H(params);
        action = action.startsWith('*')
            ? action.substring(1)
            : Kronolith.conf.URI_AJAX + '/' + action;
        if (Kronolith.conf.SESSION_ID) {
            params.update(Kronolith.conf.SESSION_ID.toQueryParams());
        }
        opts.parameters = params.toQueryString();
        opts.onComplete = function(t, o) { this.doActionComplete(t, callback); }.bind(this);
        new Ajax.Request(action, opts);
    },

    doActionComplete: function(request, callback)
    {
        this.inAjaxCallback = true;

        if (!request.responseJSON) {
            if (++this.server_error == 3) {
                this.showNotifications([ { type: 'horde.error', message: Kronolith.text.ajax_timeout } ]);
            }
            this.inAjaxCallback = false;
            return;
        }

        var r = request.responseJSON;

        if (!r.msgs) {
            r.msgs = [];
        }

        if (r.response && Object.isFunction(callback)) {
            try {
                callback(r);
            } catch (e) {
                this.debug('doActionComplete', e);
            }
        }

        if (this.server_error >= 3) {
            r.msgs.push({ type: 'horde.success', message: Kronolith.text.ajax_recover });
        }
        this.server_error = 0;

        if (!r.msgs_noauto) {
            this.showNotifications(r.msgs);
        }

        if (this.onDoActionComplete) {
            this.onDoActionComplete(r);
        }

        this.inAjaxCallback = false;
    },

    setTitle: function(title)
    {
        document.title = Kronolith.conf.name + ' :: ' + title;
        return title;
    },

    showNotifications: function(msgs)
    {
        if (!msgs.size() || this.is_logout) {
            return;
        }

        msgs.find(function(m) {
            switch (m.type) {
            case 'kronolith.timeout':
                this.logout(Kronolith.conf.timeout_url);
                return true;

            case 'horde.error':
            case 'horde.message':
            case 'horde.success':
            case 'horde.warning':
                this.Growler.growl(m.message, {
                    className: m.type.replace('.', '-'),
                    life: 8,
                    log: true,
                    sticky: m.type == 'horde.error'
                });
            }
        }, this);
    },

    logout: function(url)
    {
        this.is_logout = true;
        this.redirect(url || (Kronolith.conf.URI_IMP + '/LogOut'));
    },

    redirect: function(url)
    {
        url = this.addSID(url);
        if (parent.frames.horde_main) {
            parent.location = url;
        } else {
            window.location = url;
        }
    },

    addSID: function(url)
    {
        if (!Kronolith.conf.SESSION_ID) {
            return url;
        }
        return this.addURLParam(url, Kronolith.conf.SESSION_ID.toQueryParams());
    },

    addURLParam: function(url, params)
    {
        var q = url.indexOf('?');

        if (q != -1) {
            params = $H(url.toQueryParams()).merge(params).toObject();
            url = url.substring(0, q);
        }
        return url + '?' + Object.toQueryString(params);
    },

    go: function(fullloc, data)
    {
        var locParts = fullloc.split(':');
        var loc = locParts.shift();

        switch (loc) {
        case 'day':
        case 'week':
        case 'month':
        case 'year':
        case 'agenda':
        case 'tasks':
            var locCap = loc.capitalize();
            [ 'Day', 'Week', 'Month', 'Year', 'Tasks', 'Agenda' ].each(function(a) {
                $('kronolithNav' + a).removeClassName('on');
            });
            $('kronolithNav' + locCap).addClassName('on');
            if (this.view && this.view != loc) {
                $('kronolithView' + this.view.capitalize()).fade({ 'queue': 'end' });
            }

            switch (loc) {
            case 'day':
            case 'agenda':
            case 'week':
            case 'month':
            case 'year':
                var date = locParts.shift();
                if (date) {
                    date = this.parseDate(date);
                } else {
                    date = this.date;
                }

                if (this.view == loc && date.getYear() == this.date.getYear() &&
                    ((loc == 'year') ||
                     (loc == 'month' && date.getMonth() == this.date.getMonth()) ||
                     (loc == 'week' && date.getWeek() == this.date.getWeek()) ||
                     ((loc == 'day'  || loc == 'agenda') && date.dateString() == this.date.dateString()))) {
                         return;
                }

                this.updateView(date, loc);
                var dates = this.viewDates(date, loc);
                this._loadEvents(dates[0], dates[1], loc);
                if ($('kronolithView' + locCap)) {
                    this.viewLoading = true;
                    $('kronolithView' + locCap).appear({ 'queue': 'end', 'afterFinish': function() { this.viewLoading = false; }.bind(this) });
                }
                $('kronolithLoading' + loc).insert($('kronolithLoading').remove());
                this.updateMinical(date, loc);
                this.date = date;

                break;

            default:
                if ($('kronolithView' + locCap)) {
                    this.viewLoading = true;
                    $('kronolithView' + locCap).appear({ 'queue': 'end', 'afterFinish': function() { this.viewLoading = false; }.bind(this) });
                }
                break;
            }

            this._addHistory(fullloc);
            this.view = loc;
            break;

        case 'search':
            [ 'Day', 'Week', 'Month', 'Year', 'Tasks', 'Agenda' ].each(function(a) {
                $('kronolithNav' + a).removeClassName('on');
            });
            if (this.view) {
                $('kronolithView' + this.view.capitalize()).fade({ 'queue': 'end' });
            }
            var cals = [], term = locParts[1],
                query = Object.toJSON({ 'title': term });
            this.updateView(null, 'search', term);
            $H(Kronolith.conf.calendars).each(function(type) {
                $H(type.value).each(function(calendar) {
                    if (calendar.value.show) {
                        cals.push(type.key + '|' + calendar.key);
                    }
                });
            });
            this.startLoading('search', query, '');
            this.doAction('Search' + locParts[0],
                          { 'cals': cals.toJSON(), 'query': query },
                          function(r) {
                              // Hide spinner.
                              this.loading--;
                              if (!this.loading) {
                                  $('kronolithLoading').hide();
                              }
                              if (r.response.view != 'search' ||
                                  r.response.query != this.eventsLoading['search'] ||
                                  Object.isUndefined(r.response.events)) {
                                  return;
                              }
                              $H(r.response.events).each(function(calendars) {
                                  $H(calendars.value).each(function(events) {
                                      if (!$('kronolithAgendaDay' + events.key)) {
                                          $('kronolithViewAgendaBody').insert(this.createAgendaDay(this.parseDate(events.key), 0).show());
                                      }
                                      $H(events.value).each(function(event) {
                                          event.value.calendar = calendars.key;
                                          event.value.start = Date.parse(event.value.s);
                                          event.value.end = Date.parse(event.value.e);
                                          this._insertEvent(event, events.key, 'agenda');
                                      }, this);
                                  }, this);
                              }, this);
                          }.bind(this));
            this.viewLoading = true;
            $('kronolithViewAgenda').appear({ 'queue': 'end', 'afterFinish': function() { this.viewLoading = false; }.bind(this) });
            $('kronolithLoadingagenda').insert($('kronolithLoading').remove());
            this._addHistory(fullloc);
            this.view = 'agenda';
            break;

        case 'options':
            //this.highlightSidebar('appoptions');
            this._addHistory(loc);
            this.setTitle(Kronolith.text.prefs);
            this.iframeContent(loc, Kronolith.conf.prefs_url);
            break;
        }
    },

    /**
     * Rebuilds one of the calendar views for a new date.
     *
     * @param Date date    The date to show in the calendar.
     * @param string view  The view that's rebuilt.
     * @param mixed data   Any additional data that might be required.
     */
    updateView: function(date, view, data)
    {
        switch (view) {
        case 'day':
            this.dayEvents = [];
            this.dayGroups = [];
            this.allDayEvents = [];
            $('kronolithViewDay').down('caption span').innerHTML = this.setTitle(date.toString('D'));
            break;

        case 'week':
            this.dayEvents = [];
            this.dayGroups = [];
            this.allDayEvents = [];
            var div = $('kronolithEventsWeek').down('div'),
                th = $('kronolithViewWeekHead').down('.kronolithWeekDay'),
                td = $('kronolithViewWeekBody').down('td').next('td'),
                dates = this.viewDates(date, view),
                day = dates[0].clone();

            $('kronolithViewWeek').down('caption span').innerHTML = this.setTitle(Kronolith.text.week.interpolate({ 'week': date.getWeek() }));

            for (var i = 0; i < 7; i++) {
                div.writeAttribute('id', 'kronolithEventsWeek' + day.dateString());
                th.writeAttribute('date', day.dateString()).down('span').innerHTML = day.toString('dddd, d');
                td.down('div').writeAttribute('id', 'kronolithAllDay' + day.dateString());
                div = div.next('div');
                th = th.next('td');
                td = td.next('td');
                day.next().day();
            }
            break;

        case 'month':
            var tbody = $('kronolithViewMonthBody'),
                dates = this.viewDates(date, view),
                day = dates[0].clone(), row;

            $('kronolithViewMonth').down('caption span').innerHTML = this.setTitle(date.toString('MMMM yyyy'));

            // Remove old rows. Maybe we should only rebuild the calendars if
            // necessary.
            tbody.childElements().each(function(row) {
                if (row.identify() != 'kronolithRowTemplate') {
                    row.remove();
                }
            });

            // Build new calendar view.
            while (!day.isAfter(dates[1])) {
                tbody.insert(this.createWeekRow(day, date.getMonth(), dates).show());
                day.next().week();
            }
            this._equalRowHeights(tbody);

            break;

        case 'year':
            var viewBody = $('kronolithViewYear'), month;

            viewBody.down('caption span').innerHTML = this.setTitle(date.toString('yyyy'));

            // Build new calendar view.
            for (month = 0; month < 12; month++) {
                $('kronolithYear' + month).update(this.createYearMonth(date.getFullYear(), month).show());
            }

            break;

        case 'agenda':
        case 'search':
            var tbody = $('kronolithViewAgendaBody'), row;

            if (view == 'agenda') {
                var dates = this.viewDates(date, view),
                    day = dates[0].clone();
                this.setTitle(Kronolith.text.agenda + ' ' + dates[0].toString('d') + ' - ' + dates[1].toString('d'));
                $('kronolithViewAgenda').down('caption span').innerHTML = Kronolith.text.agenda;
            } else {
                $('kronolithViewAgenda').down('caption span').update(this.setTitle(Kronolith.text.searching.interpolate({ 'term': data })));
            }

            // Remove old rows. Maybe we should only rebuild the calendars if
            // necessary.
            tbody.childElements().each(function(row) {
                if (row.identify() != 'kronolithAgendaTemplate') {
                    row.remove();
                }
            });

            if (view == 'agenda') {
                // Build new calendar view.
                while (!day.isAfter(dates[1])) {
                    tbody.insert(this.createAgendaDay(day, 0).show());
                    day.next().day();
                }
            }
            break;
        }
    },

    /**
     * Creates a single row of day cells for usage in the month and multi-week
     * views.
     *
     * @param Date date        The first day to show in the row.
     * @param integer month    The current month. Days not from the current
     *                         month get the kronolithOtherMonth CSS class
     *                         assigned.
     * @param array viewDates  Array of Date objects with the start and end
     *                         dates of the view.
     *
     * @return Element  The element rendering a week row.
     */
    createWeekRow: function(date, month, viewDates)
    {
        var monday = date.clone(), day = date.clone(),
            today = new Date().dateString(),
            start = viewDates[0].dateString(), end = viewDates[1].dateString(),
            row, cell, dateString;

        // Find monday of the week, to determine the week number.
        if (monday.getDay() != 1) {
            monday.moveToDayOfWeek(1, 1);
        }

        // Create a copy of the row template.
        row = $('kronolithRowTemplate').cloneNode(true);
        row.removeAttribute('id');

        // Fill week number and day cells.
        cell = row.down()
            .setText(monday.getWeek())
            .writeAttribute('date', monday.dateString())
            .next();
        while (cell) {
            dateString = day.dateString();
            cell.id = 'kronolithMonthDay' + dateString;
            cell.writeAttribute('date', dateString);
            cell.removeClassName('kronolithOtherMonth').removeClassName('kronolithToday');
            if (day.getMonth() != month) {
                cell.addClassName('kronolithOtherMonth');
            }
            if (dateString == today) {
                cell.addClassName('kronolithToday');
            }
            new Drop(cell, { onDrop: function(drop) {
                var el = DragDrop.Drags.drag.element,
                    eventid = el.readAttribute('eventid'),
                    cal = el.readAttribute('calendar');
                if (drop == el.parentNode) {
                    return;
                }
                drop.insert(el);
                this.startLoading(cal, start, end);
                this.doAction('UpdateEvent',
                              { 'cal': cal,
                                'id': eventid,
                                'view': this.view,
                                'view_start': start,
                                'view_end': end,
                                'att': $H({ start_date: drop.readAttribute('date') }).toJSON() },
                              function(r) {
                                  if (r.response.events) {
                                      this._removeEvent(eventid, cal);
                                  }
                                  this._loadEventsCallback(r);
                              }.bind(this));
            }.bind(this) });
            cell.down('.kronolithDay')
                .writeAttribute('date', dateString)
                .innerHTML = day.getDate();
            cell.down('.kronolithAddEvent')
                .writeAttribute('date', dateString);
            cell = cell.next();
            day.add(1).day();
        }

        return row;
    },

    /**
     * Creates a table row for a single day in the agenda view.
     *
     * @param Date date    The first day to show in the row.
     * @param integer num  The number of the row.
     *
     * @return Element  The element rendering a week row.
     */
    createAgendaDay: function(date, num)
    {
        // Create a copy of the row template.
        var row = $('kronolithAgendaTemplate').cloneNode(true);
        row.removeAttribute('id');

        // Fill week number and day cells.
        row.addClassName('kronolithRow' + (num % 2 ? 'Odd' : 'Even'))
            .down()
            .setText(date.toString('D'))
            .next()
            .writeAttribute('id', 'kronolithAgendaDay' + date.dateString());

        return row;
    },

    /**
     * Creates a table for a single month in the year view.
     *
     * @param integer year   The year.
     * @param integer month  The month.
     *
     * @return Element  The element rendering a month table.
     */
    createYearMonth: function(year, month)
    {
        // Create a copy of the month template.
        var table = $('kronolithYearTemplate').cloneNode(true),
            tbody = table.down('tbody');
        table.removeAttribute('id');
        tbody.writeAttribute('id', 'kronolithYearTable' + month)

        // Set month name.
        table.down('SPAN')
            .writeAttribute('date', year.toPaddedString(4) + (month + 1).toPaddedString(2) + '01')
            .innerHTML = Date.CultureInfo.monthNames[month];

        // Build month table.
        this.buildMinical(tbody, new Date(year, month, 1));

        return table;
    },

    _equalRowHeights: function(tbody)
    {
        var children = tbody.childElements();
        children.invoke('setStyle', { 'height': (100 / (children.size() - 1)) + '%' });
    },

    /**
     * Calculates some dimensions for the day and week view.
     *
     * @param string storage  Property name where the dimensions are stored.
     * @param string view     DOM node ID of the view.
     */
    _calculateRowSizes: function(storage, view)
    {
        if (!Object.isUndefined(this[storage])) {
            return;
        }

        this[storage] = {};
        var trA = $(view).down('.kronolithAllDay'),
            tdA = trA.down('td'),
            tr = trA.next('tr'),
            td = tr.down('td'), height;
        this[storage].offset = tr.offsetTop - trA.offsetTop;
        this[storage].height = tr.next('tr').offsetTop - tr.offsetTop;
        this[storage].spacing = this[storage].height - tr.getHeight()
            + parseInt(td.getStyle('borderTopWidth'))
            + parseInt(td.getStyle('borderBottomWidth'));
        this[storage].allDay = tr.offsetTop - trA.offsetTop;
        this[storage].allDay -= this[storage].allDay - trA.getHeight()
            + parseInt(td.getStyle('borderTopWidth'))
            + parseInt(tdA.getStyle('borderBottomWidth'));
    },

    /**
     * Rebuilds the mini calendar.
     *
     * @param Date date    The date to show in the calendar.
     * @param string view  The view that's displayed, determines which days in
     *                     the mini calendar are highlighted.
     */
    updateMinical: function(date, view)
    {
        // Update header.
        $('kronolithMinicalDate').writeAttribute('date', date.dateString()).innerHTML = date.toString('MMMM yyyy');

        this.buildMinical($('kronolithMinical').down('tbody'), date, view);

        $('kronolithMenuCalendars').setStyle({ 'bottom': $('kronolithMenuBottom').getHeight() + 'px' });
    },

    /**
     * Creates a mini calendar suitable for the navigation calendar and the
     * year view.
     *
     * @param Element tbody  The table body to add the days to.
     * @param Date date      The date to show in the calendar.
     * @param string view    The view that's displayed, determines which days in
     *                       the mini calendar are highlighted.
     */
    buildMinical: function(tbody, date, view)
    {
        var dates = this.viewDates(date, 'month'), day = dates[0].clone(),
            date7 = date.clone().add(1).week(),
            weekStart, weekEnd, weekEndDay, td, tr;

        // Remove old calendar rows. Maybe we should only rebuild the minical
        // if necessary.
        tbody.childElements().invoke('remove');

        while (day.compareTo(dates[1]) < 1) {
            // Create calendar row and insert week number.
            if (day.getDay() == Kronolith.conf.week_start) {
                tr = new Element('tr');
                tbody.insert(tr);
                td = new Element('td', { 'class': 'kronolithMinicalWeek', 'weekdate': day.dateString() }).innerHTML = day.getWeek();
                tr.insert(td);
                weekStart = day.clone();
                weekEnd = day.clone();
                weekEnd.add(6).days();
            }
            // Insert day cell.
            td = new Element('td', {date: day.dateString()});
            if (day.getMonth() != date.getMonth()) {
                td.addClassName('kronolithMinicalEmpty');
            }
            // Highlight days currently being displayed.
            if (view &&
                (view == 'month' ||
                 (view == 'week' && date.between(weekStart, weekEnd)) ||
                 (view == 'day' && date.equals(day)) ||
                 (view == 'agenda' && !day.isBefore(date) && day.isBefore(date7)))) {
                td.addClassName('kronolithSelected');
            }
            td.innerHTML = day.getDate();
            tr.insert(td);
            day.next().day();
        }
    },

    /**
     * Rebuilds the list of calendars.
     */
    updateCalendarList: function()
    {
        var my = 0, shared = 0, ext = {}, extNames = {},
            remote, api, div;

        $H(Kronolith.conf.calendars.internal).each(function(cal) {
            if (cal.value.owner) {
                my++;
                div = $('kronolithMyCalendars');
            } else {
                shared++;
                div = $('kronolithSharedCalendars');
            }
            div.insert(new Element('DIV', { 'calendar': cal.key, 'calendarclass': 'internal', 'class': cal.value.show ? 'kronolithCalOn' : 'kronolithCalOff' })
                       .setStyle({ backgroundColor: cal.value.bg, color: cal.value.fg })
                       .update(cal.value.name));
        });
        if (my) {
            $('kronolithMyCalendars').show();
        } else {
            $('kronolithMyCalendars').hide();
        }
        if (shared) {
            $('kronolithSharedCalendars').show();
        } else {
            $('kronolithSharedCalendars').hide();
        }

        $H(Kronolith.conf.calendars.external).each(function(cal) {
            api = cal.key.split('/');
            if (typeof ext[api[0]] == 'undefined') {
                ext[api[0]] = {};
            }
            ext[api[0]][api[1]] = cal.value;
            extNames[api[0]] = cal.value.api;
        });
        $H(ext).each(function(api) {
            $('kronolithExternalCalendars')
                .insert(new Element('H3')
                        .insert(new Element('A', { 'class': 'kronolithAdd'  })
                                .update('+'))
                        .insert({ bottom: extNames[api.key] }))
                .insert(new Element('DIV', { 'id': 'kronolithExternalCalendar' + api.key, 'class': 'kronolithCalendars' }));
            $H(api.value).each(function(cal) {
                $('kronolithExternalCalendar' + api.key)
                    .insert(new Element('DIV', { 'calendar': api.key + '/' + cal.key, 'calendarclass': 'external', 'class': cal.value.show ? 'kronolithCalOn' : 'kronolithCalOff' })
                            .setStyle({ backgroundColor: cal.value.bg, color: cal.value.fg })
                            .update(cal.value.name));
            });
        });

        remote = $H(Kronolith.conf.calendars.remote);
        remote.each(function(cal) {
            $('kronolithRemoteCalendars')
                .insert(new Element('DIV', { 'calendar': cal.key, 'calendarclass': 'remote', 'class': cal.value.show ? 'kronolithCalOn' : 'kronolithCalOff' })
                        .setStyle({ backgroundColor: cal.value.bg, color: cal.value.fg })
                        .update(cal.value.name));
        });
        if (remote.size()) {
            $('kronolithRemoteCalendars').show();
        } else {
            $('kronolithRemoteCalendars').hide();
        }
    },

    /**
     * Sets the load signature and show the loading spinner.
     *
     * @param string cal    The loading calendar.
     * @param string start  The first day of the loading view.
     * @param string end    The last day of the loading view.
     */
    startLoading: function(cal, start, end)
    {
        this.eventsLoading[cal] = start + end;
        this.loading++;
        $('kronolithLoading').show();
    },

    /**
     */
    _loadEvents: function(firstDay, lastDay, view, calendars)
    {
        if (typeof calendars == 'undefined') {
            calendars = [];
            $H(Kronolith.conf.calendars).each(function(type) {
                $H(type.value).each(function(cal) {
                    if (cal.value.show) {
                        calendars.push([type.key, cal.key]);
                    }
                });
            });
        }

        calendars.each(function(cal) {
            var startDay = firstDay.clone(), endDay = lastDay.clone(),
                cals = this.ecache.get(cal[0]),
                events, date;

            if (typeof cals != 'undefined' &&
                typeof cals.get(cal[1]) != 'undefined') {
                cals = cals.get(cal[1]);
                while (!Object.isUndefined(cals.get(startDay.dateString())) &&
                       startDay.isBefore(endDay)) {
                    this._insertEvents([startDay, startDay], view, cal.join('|'));
                    startDay.add(1).day();
                }
                while (!Object.isUndefined(cals.get(endDay.dateString())) &&
                       (!startDay.isAfter(endDay))) {
                    this._insertEvents([endDay, endDay], view, cal.join('|'));
                    endDay.add(-1).day();
                }
                if (startDay.compareTo(endDay) > 0) {
                    return;
                }
            }
            var start = startDay.dateString(), end = endDay.dateString(),
                calendar = cal.join('|');
            this.startLoading(calendar, start, end);
            this._storeCache($H(), calendar);
            this.doAction('ListEvents', { start: start, end: end, cal: calendar, view: view }, this._loadEventsCallback.bind(this));
        }, this);
    },

    /**
     * Callback method for inserting events in the current view.
     *
     * @param object r  The ajax response object.
     */
    _loadEventsCallback: function(r)
    {
        // Hide spinner.
        this.loading--;
        if (!this.loading) {
            $('kronolithLoading').hide();
        }

        var start = this.parseDate(r.response.sig.substr(0, 8)),
            end = this.parseDate(r.response.sig.substr(8, 8)),
            dates = [start, end];

        this._storeCache(r.response.events || {}, r.response.cal, dates);

        // Check if this is the still the result of the most current request.
        if (r.response.view != this.view ||
            r.response.sig != this.eventsLoading[r.response.cal]) {
            return;
        }

        this._insertEvents(dates, this.view, r.response.cal);
    },

    /**
     * Reads events from the cache and inserts them into the view.
     *
     * If inserting events into day views, the calendar parameter is ignored,
     * and events from all visible calendars are inserted instead. This is
     * necessary because the complete view has to be re-rendered if events are
     * not in chronological order.
     *
     * @param Array dates      Start and end of dates to process.
     * @param string view      The view to update.
     * @param string calendar  The calendar to update.
     */
    _insertEvents: function(dates, view, calendar)
    {
        switch (view) {
        case 'day':
        case 'week':
            // The day and week views require the view to be completely
            // loaded, to correctly calculate the dimensions.
            if (this.viewLoading || this.view != view) {
                this._insertEvents.bind(this, [dates[0].clone(), dates[1].clone()], view, calendar).defer();
                return;
            }
            break;
        }

        var day = dates[0].clone(), date;
        while (!day.isAfter(dates[1])) {
            date = day.dateString();
            switch (view) {
            case 'day':
            case 'week':
                this.dayEvents = [];
                this.dayGroups = [];
                this.allDayEvents = [];
                if (view == 'day') {
                    $$('.kronolithEvent').invoke('remove');
                } else {
                    $('kronolithEventsWeek' + date)
                        .select('.kronolithEvent')
                        .invoke('remove');
                    $('kronolithAllDay' + date)
                        .select('.kronolithEvent')
                        .invoke('remove');
                }
                break;

            case 'month':
                $('kronolithMonthDay' + date)
                    .select('div[calendar=' + calendar + ']')
                    .invoke('remove');
                break;

            case 'year':
                title = '';
                busy = false;
            }

            this._getCacheForDate(date).sortBy(this._sortEvents).each(function(event) {
                switch (view) {
                case 'month':
                case 'agenda':
                    if (calendar != event.value.calendar) {
                        return;
                    }
                    break;

                case 'year':
                    if (event.value.al) {
                        title += Kronolith.text.allday;
                    } else {
                        title += event.value.start.toString('t') + '-' + event.value.end.toString('t');
                    }
                    title += ': ' + event.value.t;
                    if (event.value.x == Kronolith.conf.status.tentative ||
                        event.value.x == Kronolith.conf.status.confirmed) {
                            busy = true;
                        }
                    title += '<br />';
                    return;
                }
                this._insertEvent(event, date, view);
            }, this);

            if (view == 'year') {
                td = $('kronolithYearTable' + day.getMonth()).down('td[date=' + date + ']');
                td.className = '';
                if (title) {
                    td.writeAttribute('title', title).addClassName('kronolithHasEvents');
                    if (td.readAttribute('nicetitle')) {
                        ToolTips.detach(td);
                    }
                    ToolTips.attach(td);
                    if (busy) {
                        td.addClassName('kronolithIsBusy');
                    }
                }
            }

            day.next().day();
        }
        // Workaround Firebug bug.
        Prototype.emptyFunction();
    },

    /**
     * Creates the DOM node for an event bubble and inserts it into the view.
     *
     * @param object event     A Hash member with the event to insert.
     * @param string date      The day to update.
     * @param string view      The view to update.
     */
    _insertEvent: function(event, date, view)
    {
        event.value.nodeId = 'kronolithEvent' + view + event.value.calendar + date + event.key;

        _createElement = function(event) {
            return new Element('DIV', {
                'id': event.value.nodeId,
                'calendar': event.value.calendar,
                'eventid' : event.key,
                'class': 'kronolithEvent'
            });
        };

        switch (view) {
        case 'day':
        case 'week':
            var storage = view + 'Sizes',
                div = _createElement(event),
                style = { 'backgroundColor': event.value.bg,
                          'color': event.value.fg };

            this._calculateRowSizes(storage, view == 'day' ? 'kronolithViewDay' : 'kronolithViewWeek');

            if (event.value.al) {
                if (view == 'day') {
                    $('kronolithViewDayBody').down('td').next('td').insert(div.setStyle(style));
                } else {
                    $('kronolithAllDay' + date).insert(div.setStyle(style));
                }
                break;
            }

            var midnight = this.parseDate(date),
                innerDiv = new Element('DIV', { 'class': 'kronolithEventInfo' }),
                draggerTop = new Element('DIV', { 'id': event.value.nodeId + 'top', 'class': 'kronolithDragger kronolithDraggerTop' }).setStyle(style),
                draggerBottom = new Element('DIV', { 'id': event.value.nodeId + 'bottom', 'class': 'kronolithDragger kronolithDraggerBottom' }).setStyle(style);

            div.setStyle({
                'top': ((midnight.getElapsed(event.value.start) / 60000 | 0) * this[storage].height / 60 + this[storage].offset | 0) + 'px',
                'height': ((event.value.start.getElapsed(event.value.end) / 60000 | 0) * this[storage].height / 60 - this[storage].spacing | 0) + 'px',
                'width': '100%'
            })
                .insert(innerDiv.setStyle(style))
                .insert(draggerTop)
                .insert(draggerBottom);
            $(view == 'day' ? 'kronolithEventsDay' : 'kronolithEventsWeek' + date).insert(div);

            if (event.value.pe) {
                div.addClassName('kronolithEditable').setStyle({ 'cursor': 'move' });
                var minTop = this[storage].allDay + this[storage].spacing,
                    step = this[storage].height / 6,
                    dragTop = draggerTop.cumulativeOffset()[1],
                    dragBottom = draggerBottom.cumulativeOffset()[1],
                    dragBottomHeight = draggerBottom.getHeight(),
                    eventTop = div.cumulativeOffset()[1],
                    maxTop = div.offsetTop + draggerBottom.offsetTop
                        - this[storage].allDay - this[storage].spacing
                        - draggerTop.getHeight()
                        - parseInt(innerDiv.getStyle('lineHeight')),
                    minBottom = div.offsetTop
                        - this[storage].allDay - this[storage].spacing
                        + draggerTop.getHeight() - dragBottomHeight
                        + parseInt(innerDiv.getStyle('lineHeight')),
                    maxBottom = 24 * KronolithCore[storage].height
                        + this[storage].allDay
                        - dragBottomHeight - minTop,
                    divHeight = div.getHeight(),
                    maxDiv = 24 * KronolithCore[storage].height
                        + this[storage].allDay
                        - divHeight - minTop,
                    opts = {
                        'threshold': 5,
                        'constraint': 'vertical',
                        'scroll': 'kronolithBody',
                        'nodrop': true,
                        'parentElement': function() {
                            return $(view == 'day' ? 'kronolithEventsDay' : 'kronolithEventsWeek' + date);
                        },
                        'onStart': function(d, e) {
                            this.addClassName('kronolithSelected');
                        }.bind(div),
                        'onEnd': function(d, e) {
                            this[0]._onDragEnd(d, this[1], innerDiv, event, midnight, view);
                        }.bind([this, div]),
                        'onDrag': function(d, e) {
                            var top = d.ghost.cumulativeOffset()[1],
                                draggingTop = d.ghost.hasClassName('kronolithDraggerTop'),
                                offset, height, dates;
                            if (draggingTop) {
                                offset = top - dragTop;
                                height = this[1].offsetHeight - offset;
                                this[1].setStyle({
                                    'top': (this[1].offsetTop + offset) + 'px',
                                });
                                offset = d.ghost.offsetTop - minTop;
                                dragTop = top;
                            } else {
                                offset = top - dragBottom;
                                height = this[1].offsetHeight + offset;
                                offset = this[1].offsetTop - this[0][storage].allDay - this[0][storage].spacing;
                                dragBottom = top;
                            }
                            this[1].setStyle({
                                'height': height + 'px'
                            });
                            this[0]._calculateEventDates(event.value, storage, step, offset, height);
                            innerDiv.update('(' + event.value.start.toString(Kronolith.conf.time_format) + ' - ' + event.value.end.toString(Kronolith.conf.time_format) + ') ' + event.value.t);
                        }.bind([this, div])
                    };

                opts.snap = function(x, y, elm) {
                    y = Math.max(0, step * (Math.min(maxTop, y - minTop) / step | 0)) + minTop;
                    return [0, y];
                }
                new Drag(event.value.nodeId + 'top', opts);

                opts.snap = function(x, y, elm) {
                    y = Math.min(maxBottom, step * (Math.max(minBottom, y - minTop - dragBottomHeight) / step | 0) + dragBottomHeight) + minTop;
                    return [0, y];
                }
                new Drag(event.value.nodeId + 'bottom', opts);

                if (view == 'week') {
                    var dates = this.viewDates(midnight, view),
                        eventStart = event.value.start.clone(),
                        eventEnd = event.value.end.clone(),
                        minLeft = $('kronolithEventsWeek' + dates[0].toString('yyyyMMdd')).offsetLeft - $('kronolithEventsWeek' + date).offsetLeft,
                        maxLeft = $('kronolithEventsWeek' + dates[1].toString('yyyyMMdd')).offsetLeft - $('kronolithEventsWeek' + date).offsetLeft,
                        stepX = (maxLeft - minLeft) / 6;
                }
                new Drag(div, {
                    'threshold': 5,
                    'nodrop': true,
                    'parentElement': function() { return $(view == 'day' ? 'kronolithEventsDay' : 'kronolithEventsWeek' + date); },
                    'snap': function(x, y, elm) {
                        if (view == 'week') {
                            x = Math.max(minLeft, stepX * ((Math.min(maxLeft, x) + stepX / 2) / stepX | 0));
                        } else {
                            x = 0;
                        }
                        y = Math.max(0, step * (Math.min(maxDiv, y - minTop) / step | 0)) + minTop;
                        return [x, y];
                    },
                    'onStart': function(d, e) {
                        this.addClassName('kronolithSelected');
                        this.setStyle({ 'left': 0, 'width': '100%', 'zIndex': 1 });
                    }.bind(div),
                    'onDrag': function(d, e) {
                        if (Object.isUndefined(d.innerDiv)) {
                            d.innerDiv = d.ghost.select('.kronolithEventInfo')[0];
                        }
                        if (view == 'week') {
                            var offsetX = Math.round(d.ghost.offsetLeft / stepX);
                            this[0]._calculateEventDates(event.value, storage, step, d.ghost.offsetTop - minTop, divHeight, eventStart.clone().addDays(offsetX), eventEnd.clone().addDays(offsetX));
                        } else {
                            this[0]._calculateEventDates(event.value, storage, step, d.ghost.offsetTop - minTop, divHeight);
                        }
                        d.innerDiv.update('(' + event.value.start.toString(Kronolith.conf.time_format) + ' - ' + event.value.end.toString(Kronolith.conf.time_format) + ') ' + event.value.t);
                        this[1].clonePosition(d.ghost);
                    }.bind([this, div]),
                    'onEnd': function(d, e) {
                        this[0]._onDragEnd(d, this[1], innerDiv, event, midnight, view);
                    }.bind([this, div]),
                });
            }

            var column = 1, columns, width, left, conflict = false,
                pos = this.dayGroups.length, placeFound = false;

            this.dayEvents.each(function(ev) {
                if (!ev.end.isAfter(event.value.start)) {
                    placeFound = ev;
                    return;
                }

                if (!conflict) {
                    conflict = ev;
                    for (i = 0; i < this.dayGroups.length; i++) {
                        if (this.dayGroups[i].indexOf(conflict) != -1) {
                            if (this.dayGroups[i].indexOf(placeFound) == -1) {
                                placeFound = false;
                            }
                            break;
                        }
                    }
                }
                if (!placeFound) {
                    column++;
                }
            }, this);
            event.value.column = column;

            if (conflict) {
                for (i = 0; i < this.dayGroups.length; i++) {
                    if (this.dayGroups[i].indexOf(conflict) != -1) {
                        pos = i;
                        break;
                    }
                }
                columns = Math.max(conflict.columns, column);
            } else {
                columns = column;
            }
            if (Object.isUndefined(this.dayGroups[pos])) {
                this.dayGroups[pos] = [];
            }
            this.dayGroups[pos].push(event.value);
            width = 100 / columns;
            this.dayGroups[pos].each(function(ev) {
                ev.columns = columns;
                $(ev.nodeId).setStyle({ 'width': width + '%', 'left': (width * (ev.column - 1)) + '%' });
            });
            this.dayEvents.push(event.value);

            div = innerDiv;
            break;

        case 'month':
            var div = _createElement(event)
                .setStyle({ 'backgroundColor': event.value.bg,
                            'color': event.value.fg });

            $('kronolithMonthDay' + date).insert(div);
            if (event.value.pe) {
                div.setStyle({ 'cursor': 'move' });
                new Drag('kronolithEventmonth' + event.value.calendar + date + event.key, { threshold: 5, parentElement: function() { return $('kronolithViewMonthBody'); }, snapToParent: true });
            }
            break;

        case 'agenda':
            var div = _createElement(event)
                .setStyle({ 'backgroundColor': event.value.bg,
                            'color': event.value.fg });
            if (!event.value.al) {
                div.update(new Element('SPAN', { 'class': 'kronolithDate' }).update(event.value.start.toString('t')))
                    .insert(' ')
                    .insert(new Element('SPAN', { 'class': 'kronolithSep' }).update('&middot;'))
                    .insert(' ');
            }
            $('kronolithAgendaDay' + date).insert(div);
            break;
        }

        this._setEventText(div, event.value)
            .observe('mouseover', div.addClassName.curry('kronolithSelected'))
            .observe('mouseout', div.removeClassName.curry('kronolithSelected'));
    },

    _setEventText: function(div, event)
    {
        if (event.icn) {
            div.insert(new Element('IMG', { 'src': event.icn }));
        }

        div.insert(event.t);
        if (event.a) {
            div.insert(' ')
                .insert(new Element('IMG', { 'src': Kronolith.conf.URI_IMG + 'alarm-' + event.fg.substr(1) + '.png', 'title': Kronolith.text.alarm + ' ' + event.a }));
        }
        if (event.r) {
            div.insert(' ')
                .insert(new Element('IMG', { 'src': Kronolith.conf.URI_IMG + 'recur-' + event.fg.substr(1) + '.png', 'title': Kronolith.text.recur[event.r] }));
        }
        return div;
    },

    _removeEvent: function(event, calendar)
    {
        this._deleteCache(event, calendar);
        $('kronolithBody').select('div[calendar=' + calendar + '][eventid=' + event + ']').invoke('remove');
    },

    /**
     * Calculates the event's start and end dates based on some drag and drop
     * information.
     */
    _calculateEventDates: function(event, storage, step, offset, height, start, end)
    {
        if (!Object.isUndefined(start)) {
            event.start = start;
            event.end = end;
        }
        event.start.set({
            hour: offset / this[storage].height | 0,
            minute: Math.round(offset % this[storage].height / step * 10)
        });
        event.end.set({
            hour: (offset + height + this[storage].spacing) / this[storage].height | 0,
            minute: Math.round((offset + height + this[storage].spacing) % this[storage].height / step * 10)
        });
    },

    /**
     * Called as the event handler after dragging/resizing a day/week event.
     */
    _onDragEnd: function(drag, div, innerDiv, event, date, view)
    {
        var dates = this.viewDates(date, view),
            start = dates[0].toString('yyyyMMdd'),
            end = dates[1].toString('yyyyMMdd');
        div.removeClassName('kronolithSelected');
        this._setEventText(innerDiv, event.value);
        drag.destroy();
        this.startLoading(event.value.calendar, start, end);
        this.doAction(
            'UpdateEvent',
            { 'cal': event.value.calendar,
              'id': event.key,
              'view': view,
              'view_start': start,
              'view_end': end,
              'att': $H({
                  start: event.value.start,
                  end: event.value.end,
              }).toJSON()
            },
            function(r) {
                if (r.response.events) {
                    this._removeEvent(event.key, event.value.calendar);
                }
                this._loadEventsCallback(r);
            }.bind(this));
    },

    /**
     * Parses a date attribute string into a Date object.
     *
     * For other strings use Date.parse().
     *
     * @param string date  A yyyyMMdd date string.
     *
     * @return Date  A date object.
     */
    parseDate: function(date)
    {
        return new Date(date.substr(0, 4), date.substr(4, 2) - 1, date.substr(6, 2));
    },

    /**
     * Calculates first and last days being displayed.
     *
     * @var Date date    The date of the view.
     * @var string view  A view name.
     *
     * @return array  Array with first and last day of the view.
     */
    viewDates: function(date, view)
    {
        var start = date.clone(), end = date.clone();

        switch (view) {
        case 'week':
            start.moveToBeginOfWeek();
            end.moveToEndOfWeek();
            break;
        case 'month':
            start.setDate(1);
            start.moveToBeginOfWeek();
            end.moveToLastDayOfMonth();
            end.moveToEndOfWeek();
            break;
        case 'year':
            start.setDate(1);
            start.setMonth(0);
            end.setMonth(11);
            end.moveToLastDayOfMonth();
            break;
        case 'agenda':
            end.add(6).days();
            break;
        }

        return [start, end];
    },

    /**
     * Stores a set of events in the cache.
     *
     * For dates in the specified date ranges that don't contain any events,
     * empty cache entries are created so that those dates aren't re-fetched
     * each time.
     *
     * @param object events    A list of calendars and events as returned from
     *                         an ajax request.
     * @param string calendar  A calendar string or array.
     * @param string dates     A date range in the format yyyymmddyyyymmdd as
     *                         used in the ajax response signature.
     */
    _storeCache: function(events, calendar, dates)
    {
        if (Object.isString(calendar)) {
            calendar = calendar.split('|');
        }

        // Create cache entry for the calendar.
        if (!this.ecache.get(calendar[0])) {
            this.ecache.set(calendar[0], $H());
        }
        if (!this.ecache.get(calendar[0]).get(calendar[1])) {
            this.ecache.get(calendar[0]).set(calendar[1], $H());
        }
        var calHash = this.ecache.get(calendar[0]).get(calendar[1]);

        // Create empty cache entries for all dates.
        if (typeof dates != 'undefined') {
            var day = dates[0].clone(), date;
            while (!day.isAfter(dates[1])) {
                date = day.dateString();
                if (!calHash.get(date)) {
                    calHash.set(date, $H());
                }
                day.add(1).day();
            }
        }

        var cal = calendar.join('|');
        $H(events).each(function(date) {
            // Store calendar string and other useful information in event
            // objects.
            $H(date.value).each(function(event) {
                event.value.calendar = cal;
                event.value.start = Date.parse(event.value.s);
                event.value.end = Date.parse(event.value.e);
                event.value.sort = event.value.start.toString('HHmmss')
                    + (240000 - parseInt(event.value.end.toString('HHmmss'))).toPaddedString(6);
            });

            // Store events in cache.
            calHash.set(date.key, calHash.get(date.key).merge(date.value));
        });
    },

    /**
     * Deletes an event from the cache.
     *
     * @param string event     An event ID.
     * @param string calendar  A calendar string or array.
     */
    _deleteCache: function(event, calendar)
    {
        if (Object.isString(calendar)) {
            calendar = calendar.split('|');
        }
        if (!this.ecache.get(calendar[0]) ||
            !this.ecache.get(calendar[0]).get(calendar[1])) {
            return;
        }
        this.ecache.get(calendar[0]).get(calendar[1]).each(function(day) {
            delete day.value[event];
        });
    },

    /**
     * Return all events for a single day from all displayed calendars merged
     * into a single hash.
     *
     * @param string date  A yyyymmdd date string.
     *
     * @return Hash  An event hash which event ids as keys and event objects as
     *               values.
     */
    _getCacheForDate: function(date)
    {
        var events = $H();
        this.ecache.each(function(type) {
            type.value.each(function(cal) {
                if (!Kronolith.conf.calendars[type.key][cal.key].show) {
                    return;
                }
                events = events.merge(cal.value.get(date));
            });
        });
        return events;
    },

    /**
     * Helper method for Enumerable.sortBy to sort events first by start time,
     * second by end time reversed.
     *
     * @param Hash event  A hash entry with the event object as the value.
     *
     * @return string  A comparable string.
     */
    _sortEvents: function(event)
    {
        return event.value.sort;
    },

    _addHistory: function(loc, data)
    {
        if (Horde.dhtmlHistory.getCurrentLocation() != loc) {
            Horde.dhtmlHistory.add(loc, data);
        }
    },

    iframeContent: function(name, loc)
    {
        if (name === null) {
            name = loc;
        }

        var container = $('dimpmain_portal'), iframe;
        if (!container) {
            this.showNotifications([ { type: 'horde.error', message: 'Bad portal!' } ]);
            return;
        }

        iframe = new Element('IFRAME', { id: 'iframe' + name, className: 'iframe', frameBorder: 0, src: loc });
        this._resizeIE6Iframe(iframe);

        // Hide menu in prefs pages.
        if (name == 'options') {
            iframe.observe('load', function() { $('iframeoptions').contentWindow.document.getElementById('menu').style.display = 'none'; });
        }

        container.insert(iframe);
    },

    onResize: function(noupdate, nowait)
    {
    },

    /* Keydown event handler */
    keydownHandler: function(e)
    {
        var kc = e.keyCode || e.charCode;

        form = e.findElement('FORM');
        if (form) {
            switch (kc) {
            case Event.KEY_RETURN:
                switch (form.identify()) {
                case 'kronolithEventForm':
                    this.saveEvent();
                    e.stop();
                    break;

                case 'kronolithSearchForm':
                    this.go('search:' + $F('kronolithSearchContext') + ':' + $F('kronolithSearchTerm'))
                    e.stop();
                    break;
                }
                break;
            }
            return;
        }

        switch (kc) {
        case Event.KEY_ESC:
            this._closeRedBox();
            break;
        }
    },

    keyupHandler: function(e)
    {
        /*
        if (e.element().readAttribute('id') == 'foo') {
        }
        */
    },

    clickHandler: function(e, dblclick)
    {
        if (e.isRightClick()) {
            return;
        }

        var elt = e.element(),
            orig = e.element(),
            id, tmp, calendar, calendarClass;

        while (Object.isElement(elt)) {
            id = elt.readAttribute('id');

            switch (id) {
            case 'kronolithLogo':
                this.go('portal');
                e.stop();
                return;

            case 'id_fullday':
                this.eventForm.select('.edit_at').each(Element.toggle);
                e.stop();
                return;

            case 'kronolithNewEvent':
                this.editEvent();
                e.stop();
                return;

            case 'kronolithEventSave':
                this.saveEvent();
                e.stop();
                return;

            case 'kronolithEventDelete':
                var cal = $F('kronolithEventCalendar'),
                    eventid = $F('kronolithEventId');
                this.doAction('DeleteEvent',
                              { 'cal': cal, 'id': eventid },
                              function(r) {
                                  if (r.response.deleted) {
                                      this._removeEvent(eventid, cal);
                                  } else {
                                      $('kronolithBody').select('div[calendar=' + cal + '][eventid=' + eventid + ']').invoke('toggle');
                                  }
                              }.bind(this));
                $('kronolithBody').select('div[calendar=' + cal + '][eventid=' + eventid + ']').invoke('hide');
                this._closeRedBox();
                e.stop();
                return;

            case 'kronolithEventCancel':
                this._closeRedBox();
                e.stop();
                return;

            case 'kronolithNavDay':
            case 'kronolithNavWeek':
            case 'kronolithNavMonth':
            case 'kronolithNavYear':
            case 'kronolithNavTasks':
            case 'kronolithNavAgenda':
                this.go(id.substring(12).toLowerCase() + ':' + this.date.dateString());
                e.stop();
                return;

            case 'kronolithMinicalDate':
                this.go('month:' + orig.readAttribute('date'));
                e.stop();
                return;

            case 'kronolithMinical':
                if (orig.id == 'kronolithMinicalPrev') {
                    var date = this.parseDate($('kronolithMinicalDate').readAttribute('date'));
                    date.previous().month();
                    this.updateMinical(date);
                    e.stop();
                    return;
                }
                if (orig.id == 'kronolithMinicalNext') {
                    var date = this.parseDate($('kronolithMinicalDate').readAttribute('date'));
                    date.next().month();
                    this.updateMinical(date);
                    e.stop();
                    return;
                }

                var tmp = orig;
                if (tmp.tagName != 'td') {
                    tmp.up('td');
                }
                if (tmp) {
                    if (tmp.readAttribute('weekdate') &&
                        tmp.hasClassName('kronolithMinicalWeek')) {
                        this.go('week:' + tmp.readAttribute('weekdate'));
                    } else if (tmp.readAttribute('date') &&
                               !tmp.hasClassName('empty')) {
                        this.go('day:' + tmp.readAttribute('date'));
                    }
                }
                e.stop();
                return;

            case 'kronolithViewMonth':
                if (orig.hasClassName('kronolithFirstCol')) {
                    var date = orig.readAttribute('date');
                    if (date) {
                        this.go('week:' + date);
                        e.stop();
                        return;
                    }
                } else if (orig.hasClassName('kronolithDay')) {
                    var date = orig.readAttribute('date');
                    if (date) {
                        this.go('day:' + date);
                        e.stop();
                        return;
                    }
                }
                e.stop();
                return;

            case 'kronolithViewYear':
                var tmp = orig;
                if (tmp.tagName != 'td') {
                    tmp.up('td');
                }
                if (tmp) {
                    if (tmp.readAttribute('weekdate') &&
                        tmp.hasClassName('kronolithMinicalWeek')) {
                        this.go('week:' + tmp.readAttribute('weekdate'));
                    } else if (tmp.hasClassName('kronolithMinicalDate')) {
                        this.go('month:' + tmp.readAttribute('date'));
                    } else if (tmp.readAttribute('date') &&
                               !tmp.hasClassName('empty')) {
                        this.go('day:' + tmp.readAttribute('date'));
                    }
                }
                e.stop();
                return;

            case 'kronolithSearchButton':
                this.go('search:' + $F('kronolithSearchContext') + ':' + $F('kronolithSearchTerm'))
                break;

            case 'alertsloglink':
                tmp = $('alertsloglink').down('A');
                if (this.Growler.toggleLog()) {
                    tmp.update(DIMP.text.hidealog);
                } else {
                    tmp.update(DIMP.text.showalog);
                }
                break;
            }

            // Caution, this only works if the element has definitely only a
            // single CSS class.
            switch (elt.className) {
            case 'kronolithGotoToday':
                this.go(this.view + ':' + new Date().dateString());
                e.stop();
                return;

            case 'kronolithPrev':
            case 'kronolithNext':
                var newDate = this.date.clone(),
                    offset = elt.className == 'kronolithPrev' ? -1 : 1;
                switch (this.view) {
                case 'day':
                case 'agenda':
                    newDate.add(offset).day();
                    break;
                case 'week':
                    newDate.add(offset).week();
                    break;
                case 'month':
                    newDate.add(offset).month();
                    break;
                case 'year':
                    newDate.add(offset).year();
                    break;
                }
                this.go(this.view + ':' + newDate.dateString());
                e.stop();
                return;

            case 'kronolithAddEvent':
                this.editEvent(null, null, elt.readAttribute('date'));
                e.stop();
                return;

            case 'kronolithEventTag':
                $('tags').autocompleter.addNewItemNode(elt.getText());
                e.stop();
                return;
            }

            if (elt.hasClassName('kronolithEvent')) {
                this.editEvent(elt.readAttribute('calendar'), elt.readAttribute('eventid'));
                e.stop();
                return;
            } else if (elt.hasClassName('kronolithWeekDay')) {
                this.go('day:' + elt.readAttribute('date'));
                e.stop();
                return;
            }

            calClass = elt.readAttribute('calendarclass');
            if (calClass) {
                var calendar = elt.readAttribute('calendar');
                Kronolith.conf.calendars[calClass][calendar].show = !Kronolith.conf.calendars[calClass][calendar].show;
                if (this.view == 'year' ||
                    typeof this.ecache.get(calClass) == 'undefined' ||
                    typeof this.ecache.get(calClass).get(calendar) == 'undefined') {
                    var dates = this.viewDates(this.date, this.view);
                    this._loadEvents(dates[0], dates[1], this.view, [[calClass, calendar]]);
                } else {
                    $('kronolithBody').select('div[calendar=' + calClass + '|' + calendar + ']').invoke('toggle');
                }
                elt.toggleClassName('kronolithCalOn');
                elt.toggleClassName('kronolithCalOff');
                if (calClass == 'remote' || calClass == 'external') {
                    calendar = calClass + '_' + calendar;
                }
                this.doAction('SaveCalPref', { toggle_calendar: calendar });
            }

            elt = elt.up();
        }
        // Workaround Firebug bug.
        Prototype.emptyFunction();
    },

    mouseHandler: function(e, type)
    {
        /*
        var elt = e.element();

        switch (type) {
        case 'over':
            if (DragDrop.Drags.drag && elt.hasClassName('exp')) {
                this._toggleSubFolder(elt.up(), 'exp');
            }
            break;
        }
        */
    },

    editEvent: function(calendar, id, date)
    {
        RedBox.onDisplay = function() {
            try {
                $('kronolithEventForm').focusFirstElement();
            } catch(e) {}
            RedBox.onDisplay = null;
        };

        $('tags').autocompleter.init();
        $('kronolithEventForm').enable();
        $('kronolithEventForm').reset();
        this.doAction('ListTopTags', {}, this._topTags);
        if (id) {
            RedBox.loading();
            this.doAction('GetEvent', { 'cal': calendar, 'id': id }, this._editEvent.bind(this));
        } else {
            var d = date ? this.parseDate(date) : new Date();
            $('kronolithEventId').value = '';
            $('kronolithEventCalendar').value = Kronolith.conf.default_calendar;
            $('kronolithEventDelete').hide();
            $('kronolithEventStartDate').value = d.toString(Kronolith.conf.date_format);
            $('kronolithEventStartTime').value = d.toString(Kronolith.conf.time_format);
            d.add(1).hour();
            $('kronolithEventEndDate').value = d.toString(Kronolith.conf.date_format);
            $('kronolithEventEndTime').value = d.toString(Kronolith.conf.time_format);
            RedBox.showHtml($('kronolithEventDialog').show());
            this.eventForm = RedBox.getWindowContents();
        }
    },

    saveEvent: function()
    {
        var cal = $F('kronolithEventCalendar'),
            eventid = $F('kronolithEventId'),
            viewDates = this.viewDates(this.date, this.view),
            start = viewDates[0].dateString(),
            end = viewDates[1].dateString();
        this.startLoading(cal, start, end);
        this.doAction('SaveEvent',
                      $H($('kronolithEventForm').serialize({ 'hash': true }))
                          .merge({
                              'view': this.view,
                              'view_start': start,
                              'view_end': end
                          }),
                      function(r) {
                          if (r.response.events && eventid) {
                              this._removeEvent(eventid, cal);
                          }
                          this._loadEventsCallback(r);
                          this._closeRedBox();
                      }.bind(this));
    },

    _topTags: function(r)
    {
        if (!r.response.tags) {
            $('kronolithEventTopTags').update();
            return;
        }
        t = new Element('div', {});
        r.response.tags.each(function(tag) {
            t.insert(new Element('span', { 'class': 'kronolithEventTag' }).update(tag));
        });
        $('kronolithEventTopTags').update(t);
        return;
    },

    /**
     * Callback method for showing event forms.
     *
     * @param object r  The ajax response object.
     */
    _editEvent: function(r)
    {
        if (!r.response.event) {
            RedBox.close();
            return;
        }

        var ev = r.response.event;
        $('kronolithEventId').value = ev.id;
        $('kronolithEventCalendar').value = ev.ty + '|' + ev.c;
        $('kronolithEventTitle').value = ev.t;
        $('kronolithEventLocation').value = ev.l;
        $('kronolithEventAllday').checked = ev.al;
        $('kronolithEventStartDate').value = ev.sd
        $('kronolithEventStartTime').value = ev.st;
        $('kronolithEventEndDate').value = ev.ed;
        $('kronolithEventEndTime').value = ev.et;
        $('tags').autocompleter.init(ev.tg);
        if (ev.r) {
            // @todo: refine
            $A($('kronolithEventRecurrence').options).find(function(option) {
                return option.value == ev.r || option.value == -1;
                }).selected = true;
        }
        if (ev.pe) {
            $('kronolithEventSave').show();
            $('kronolithEventForm').enable();
        } else {
            $('kronolithEventSave').hide();
            $('kronolithEventForm').disable();
            $('kronolithEventCancel').enable();
        }
        if (ev.pd) {
            $('kronolithEventDelete').show();
        } else {
            $('kronolithEventDelete').hide();
        }

        RedBox.showHtml($('kronolithEventDialog').show());
        this.eventForm = RedBox.getWindowContents();
    },

    _closeRedBox: function()
    {
        RedBox.close();
        this.eventForm = null;
    },

    /* Onload function. */
    onDomLoad: function()
    {
        if (typeof ContextSensitive != 'undefined') {
            this.DMenu = new ContextSensitive({ onClick: this.contextOnClick, onShow: this.contextOnShow });
        }

        document.observe('keydown', KronolithCore.keydownHandler.bindAsEventListener(KronolithCore));
        document.observe('keyup', KronolithCore.keyupHandler.bindAsEventListener(KronolithCore));
        document.observe('click', KronolithCore.clickHandler.bindAsEventListener(KronolithCore));
        document.observe('dblclick', KronolithCore.clickHandler.bindAsEventListener(KronolithCore, true));
        document.observe('mouseover', KronolithCore.mouseHandler.bindAsEventListener(KronolithCore, 'over'));

        if (Horde.dhtmlHistory.initialize()) {
            Horde.dhtmlHistory.addListener(this.go.bind(this));
        }

        this.updateCalendarList();

        /* Initialize the starting page if necessary. addListener() will have
         * already fired if there is a current location so only do a go()
         * call if there is no current location. */
        if (!Horde.dhtmlHistory.getCurrentLocation()) {
            this.go(Kronolith.conf.login_view);
        }

        $('kronolithMenu').select('div.kronolithCalendars div').each(function(s) {
            s.observe('mouseover', s.addClassName.curry('kronolithCalOver'));
            s.observe('mouseout', s.removeClassName.curry('kronolithCalOver'));
        });

        /* Add Growler notifications. */
        this.Growler = new Growler({
            location: 'br',
            log: true,
            noalerts: Kronolith.text.noalerts
        });

        if (Kronolith.conf.is_ie6) {
            /* Disable text selection in preview pane for IE 6. */
            document.observe('selectstart', Event.stop);

            /* Since IE 6 doesn't support hover over non-links, use javascript
             * events to replicate mouseover CSS behavior. */
            $('foobar').compact().invoke('select', 'LI').flatten().compact().each(function(e) {
                e.observe('mouseover', e.addClassName.curry('over')).observe('mouseout', e.removeClassName.curry('over'));
            });
        }
    },

    toggleCalendar: function(elm)
    {
        elm.toggleClassName('on');
    },

    // By default, no context onShow action
    contextOnShow: Prototype.emptyFunction,

    // By default, no context onClick action
    contextOnClick: Prototype.emptyFunction

};

/* Helper methods for setting/getting element text without mucking
 * around with multiple TextNodes. */
Element.addMethods({
    setText: function(element, text)
    {
        var t = 0;
        $A(element.childNodes).each(function(node) {
            if (node.nodeType == 3) {
                if (t++) {
                    Element.remove(node);
                } else {
                    node.nodeValue = text;
                }
            }
        });

        if (!t) {
            $(element).insert(text);
        }

        return element;
    },

    getText: function(element, recursive)
    {
        var text = '';
        $A(element.childNodes).each(function(node) {
            if (node.nodeType == 3) {
                text += node.nodeValue;
            } else if (recursive && node.hasChildNodes()) {
                text += $(node).getText(true);
            }
        });
        return text;
    }
});

/* Create some utility functions. */
Object.extend(Array.prototype, {
    // Need our own diff() function because prototypejs's without() function
    // does not handle array input.
    diff: function(values)
    {
        return this.select(function(value) {
            return !values.include(value);
        });
    },
    numericSort: function()
    {
        return this.collect(Number).sort(function(a,b) {
            return (a > b) ? 1 : ((a < b) ? -1 : 0);
        });
    }
});

Object.extend(String.prototype, {
    // We define our own version of evalScripts() to make sure that all
    // scripts are running in the same scope and that all functions are
    // defined in the global scope. This is not the case when using
    // prototype's evalScripts().
    evalScripts: function()
    {
        var re = /function\s+([^\s(]+)/g;
        this.extractScripts().each(function(s) {
            var func;
            eval(s);
            while (func = re.exec(s)) {
                window[func[1]] = eval(func[1]);
            }
        });
    }
});

Object.extend(Date.prototype, {
    /**
     * Moves a date to the end of the corresponding week.
     *
     * @return Date  The same Date object, now pointing to the end of the week.
     */
    moveToEndOfWeek: function()
    {
        var weekEndDay = Kronolith.conf.week_start + 6;
        if (weekEndDay > 6) {
            weekEndDay -= 7;
        }
        if (this.getDay() != weekEndDay) {
            this.moveToDayOfWeek(weekEndDay, 1);
        }
        return this;
    },

    /**
     * Moves a date to the begin of the corresponding week.
     *
     * @return Date  The same Date object, now pointing to the begin of the
     *               week.
     */
    moveToBeginOfWeek: function()
    {
        if (this.getDay() != Kronolith.conf.week_start) {
            this.moveToDayOfWeek(Kronolith.conf.week_start, -1);
        }
        return this;
    },

    /**
     * Format date and time to be passed around as a short url parameter,
     * cache id, etc.
     *
     * @return string  Date and time.
     */
    dateString: function()
    {
        return this.toString('yyyyMMdd');
    }

});

/* Initialize global event handlers. */
document.observe('dom:loaded', KronolithCore.onDomLoad.bind(KronolithCore));
Event.observe(window, 'resize', KronolithCore.onResize.bind(KronolithCore));
