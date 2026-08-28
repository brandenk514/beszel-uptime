package uptime

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testMonitorCollection(t *testing.T) *core.Collection {
	t.Helper()
	c := core.NewBaseCollection("monitors")
	for _, f := range []core.Field{
		&core.TextField{Name: "name"},
		&core.SelectField{Name: "type", Values: []string{"http", "tcp", "ping", "push"}},
		&core.TextField{Name: "url"},
		&core.TextField{Name: "host"},
		&core.NumberField{Name: "port", OnlyInt: true},
		&core.NumberField{Name: "interval", OnlyInt: true},
		&core.NumberField{Name: "timeout", OnlyInt: true},
		&core.BoolField{Name: "retry"},
		&core.NumberField{Name: "retry_delay", OnlyInt: true},
		&core.NumberField{Name: "num_retries", OnlyInt: true},
		&core.TextField{Name: "dns_type"},
		&core.TextField{Name: "dns_value"},
		&core.TextField{Name: "docker_url"},
		&core.TextField{Name: "app_id"},
		&core.SelectField{Name: "status", Values: []string{"up", "down", "paused", "pending"}},
		&core.AutodateField{Name: "updated"},
	} {
		c.Fields = append(c.Fields, f)
	}
	return c
}

// testMonitorRecord builds a monitor record whose Original() state equals the
// given "stored" values, then applies the "new" values on top — mirroring a
// record loaded from the DB (stored) and then saved (new).
func testMonitorRecord(t *testing.T, stored, incoming map[string]any) *core.Record {
	t.Helper()
	c := testMonitorCollection(t)
	rec := core.NewRecord(c)
	rec.Id = "monitor-1"
	for k, v := range stored {
		rec.Set(k, v)
	}
	require.NoError(t, rec.PostScan(), "original state")
	for k, v := range incoming {
		rec.Set(k, v)
	}
	return rec
}

func TestMonitorConfigChanged(t *testing.T) {
	m := &MonitorManager{}

	t.Run("status transition up to down does not restart loop", func(t *testing.T) {
		rec := testMonitorRecord(t, map[string]any{"status": "up"}, map[string]any{"status": "down"})
		assert.False(t, m.monitorConfigChanged(rec), "up->down transition must not restart the check loop")
	})

	t.Run("status transition down to up does not restart loop", func(t *testing.T) {
		rec := testMonitorRecord(t, map[string]any{"status": "down"}, map[string]any{"status": "up"})
		assert.False(t, m.monitorConfigChanged(rec), "down->up transition must not restart the check loop")
	})

	t.Run("pausing restarts loop", func(t *testing.T) {
		rec := testMonitorRecord(t, map[string]any{"status": "up"}, map[string]any{"status": "paused"})
		assert.True(t, m.monitorConfigChanged(rec))
	})

	t.Run("resuming restarts loop", func(t *testing.T) {
		rec := testMonitorRecord(t, map[string]any{"status": "paused"}, map[string]any{"status": "pending"})
		assert.True(t, m.monitorConfigChanged(rec))
	})

	t.Run("interval change restarts loop", func(t *testing.T) {
		rec := testMonitorRecord(t, map[string]any{"interval": 60}, map[string]any{"interval": 120})
		assert.True(t, m.monitorConfigChanged(rec))
	})

	t.Run("timeout change restarts loop", func(t *testing.T) {
		rec := testMonitorRecord(t, map[string]any{"timeout": 10}, map[string]any{"timeout": 30})
		assert.True(t, m.monitorConfigChanged(rec))
	})

	t.Run("host change restarts loop", func(t *testing.T) {
		rec := testMonitorRecord(t, map[string]any{"host": "a.example.com"}, map[string]any{"host": "b.example.com"})
		assert.True(t, m.monitorConfigChanged(rec))
	})

	t.Run("no config change does not restart loop", func(t *testing.T) {
		rec := testMonitorRecord(t, map[string]any{"status": "up", "interval": 60}, map[string]any{"status": "up", "interval": 60})
		assert.False(t, m.monitorConfigChanged(rec))
	})
}
