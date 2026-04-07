// Package uptime schedules and runs uptime checks for HTTP/HTTPS/TCP monitors.
package uptime

import (
	"fmt"
	"sync"
	"time"

	"github.com/henrygd/beszel/internal/alerts"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const (
	defaultInterval = 60  // seconds
	defaultTimeout  = 30  // seconds
	maxEvents       = 500 // events kept per monitor

	statusUp      = "up"
	statusDown    = "down"
	statusUnknown = "unknown"
)

type hubLike interface {
	core.App
	MakeLink(parts ...string) string
	SendAlert(data alerts.AlertMessageData) error
}

// UptimeManager schedules uptime checks and handles results.
type UptimeManager struct {
	hub    hubLike
	mu     sync.Mutex
	timers map[string]*time.Timer // keyed by monitor record ID
}

// NewUptimeManager creates and wires up a new UptimeManager.
func NewUptimeManager(hub hubLike) *UptimeManager {
	um := &UptimeManager{
		hub:    hub,
		timers: make(map[string]*time.Timer),
	}
	um.bindEvents()
	return um
}

func (um *UptimeManager) bindEvents() {
	um.hub.OnServe().BindFunc(func(e *core.ServeEvent) error {
		go um.scheduleAll()
		return e.Next()
	})

	um.hub.OnRecordAfterCreateSuccess("uptime_monitors").BindFunc(func(e *core.RecordEvent) error {
		go um.scheduleMonitor(e.Record)
		return e.Next()
	})
	um.hub.OnRecordAfterUpdateSuccess("uptime_monitors").BindFunc(func(e *core.RecordEvent) error {
		go um.scheduleMonitor(e.Record)
		return e.Next()
	})

	um.hub.OnRecordAfterDeleteSuccess("uptime_monitors").BindFunc(func(e *core.RecordEvent) error {
		um.cancelMonitor(e.Record.Id)
		return e.Next()
	})
}

func (um *UptimeManager) scheduleAll() {
	records, err := um.hub.FindAllRecords("uptime_monitors")
	if err != nil {
		um.hub.Logger().Error("uptime: failed to load monitors", "err", err)
		return
	}
	for _, r := range records {
		um.scheduleMonitor(r)
	}
}

func (um *UptimeManager) scheduleMonitor(record *core.Record) {
	um.cancelMonitor(record.Id)
	if !record.GetBool("enabled") {
		return
	}
	um.scheduleNext(record.Id, record.GetInt("interval"))
}

// scheduleNext enqueues the next check for a monitor after interval seconds.
func (um *UptimeManager) scheduleNext(monitorID string, interval int) {
	if interval <= 0 {
		interval = defaultInterval
	}
	um.mu.Lock()
	um.timers[monitorID] = time.AfterFunc(time.Duration(interval)*time.Second, func() {
		um.runCheck(monitorID)
	})
	um.mu.Unlock()
}

func (um *UptimeManager) cancelMonitor(id string) {
	um.mu.Lock()
	defer um.mu.Unlock()
	if t, ok := um.timers[id]; ok {
		t.Stop()
		delete(um.timers, id)
	}
}

// RunCheckNow triggers an immediate check for a monitor (caller must have already validated ownership).
func (um *UptimeManager) RunCheckNow(monitorID string) error {
	go um.runCheck(monitorID)
	return nil
}

func (um *UptimeManager) runCheck(monitorID string) {
	record, err := um.hub.FindRecordById("uptime_monitors", monitorID)
	if err != nil {
		// Monitor was likely deleted.
		return
	}

	monitorType := record.GetString("type")
	timeout := record.GetInt("timeout")
	if timeout <= 0 {
		timeout = defaultTimeout
	}

	var result CheckResult
	switch monitorType {
	case "http", "https":
		url := record.GetString("url")
		if url == "" {
			return
		}
		result = CheckHTTP(url, timeout)
	case "tcp":
		host := record.GetString("host")
		port := record.GetInt("port")
		if host == "" || port == 0 {
			return
		}
		result = CheckTCP(host, port, timeout)
	default:
		return
	}

	prevStatus := record.GetString("status")
	newStatus := statusDown
	if result.Up {
		newStatus = statusUp
	}

	um.saveEvent(record, result)

	record.Set("status", newStatus)
	record.Set("response_time", result.ResponseTime)
	record.Set("last_checked", time.Now().UTC().Format(time.RFC3339))
	if err := um.hub.Save(record); err != nil {
		um.hub.Logger().Error("uptime: failed to update monitor", "id", monitorID, "err", err)
	}

	// Skip the very first check ("unknown" → X) to avoid false alerts before stable state.
	if prevStatus != statusUnknown && prevStatus != "" && prevStatus != newStatus {
		um.sendStatusAlert(record, newStatus)
	}

	um.scheduleNext(monitorID, record.GetInt("interval"))
}

func (um *UptimeManager) saveEvent(monitor *core.Record, result CheckResult) {
	col, err := um.hub.FindCachedCollectionByNameOrId("uptime_events")
	if err != nil {
		return
	}
	ev := core.NewRecord(col)
	ev.Set("monitor", monitor.Id)
	ev.Set("up", result.Up)
	ev.Set("response_time", result.ResponseTime)
	ev.Set("status_code", result.StatusCode)
	ev.Set("msg", result.Message)
	if err := um.hub.Save(ev); err != nil {
		um.hub.Logger().Error("uptime: failed to save event", "err", err)
		return
	}

	go um.pruneEvents(monitor.Id)
}

// pruneEvents keeps only the most recent maxEvents records for a monitor.
func (um *UptimeManager) pruneEvents(monitorID string) {
	_, _ = um.hub.DB().NewQuery(
		"DELETE FROM uptime_events WHERE monitor = {:m} AND id NOT IN " +
			"(SELECT id FROM uptime_events WHERE monitor = {:m} ORDER BY created DESC LIMIT {:max})",
	).Bind(dbx.Params{"m": monitorID, "max": maxEvents}).Execute()
}

func (um *UptimeManager) sendStatusAlert(monitor *core.Record, newStatus string) {
	var title, message string
	monitorName := monitor.GetString("name")
	if newStatus == statusUp {
		title = fmt.Sprintf("✅ %s is up", monitorName)
		message = fmt.Sprintf("%s is back online.", monitorName)
	} else {
		title = fmt.Sprintf("🔴 %s is down", monitorName)
		message = fmt.Sprintf("%s appears to be unreachable.", monitorName)
	}

	link := um.hub.MakeLink("uptime")
	if err := um.hub.SendAlert(alerts.AlertMessageData{
		UserID:   monitor.GetString("user"),
		SystemID: "",
		Title:    title,
		Message:  message,
		Link:     link,
		LinkText: "View Uptime",
	}); err != nil {
		um.hub.Logger().Error("uptime: failed to send status alert", "monitor", monitor.Id, "err", err)
	}
}
