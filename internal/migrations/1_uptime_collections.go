package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		jsonData := `[
	{
		"id": "uptime_monitors_col",
		"listRule": "@request.auth.id != \"\" && user = @request.auth.id",
		"viewRule": "@request.auth.id != \"\" && user = @request.auth.id",
		"createRule": "@request.auth.id != \"\" && @request.auth.role != \"readonly\"",
		"updateRule": "@request.auth.id != \"\" && user = @request.auth.id && @request.auth.role != \"readonly\"",
		"deleteRule": "@request.auth.id != \"\" && user = @request.auth.id && @request.auth.role != \"readonly\"",
		"name": "uptime_monitors",
		"type": "base",
		"fields": [
			{
				"autogeneratePattern": "[a-z0-9]{15}",
				"hidden": false,
				"id": "text3208210257",
				"max": 15,
				"min": 15,
				"name": "id",
				"pattern": "^[a-z0-9]+$",
				"presentable": false,
				"primaryKey": true,
				"required": true,
				"system": true,
				"type": "text"
			},
			{
				"cascadeDelete": true,
				"collectionId": "_pb_users_auth_",
				"hidden": false,
				"id": "upmon_user",
				"maxSelect": 1,
				"minSelect": 0,
				"name": "user",
				"presentable": false,
				"required": true,
				"system": false,
				"type": "relation"
			},
			{
				"hidden": false,
				"id": "upmon_name",
				"max": 100,
				"min": 1,
				"name": "name",
				"pattern": "",
				"presentable": true,
				"primaryKey": false,
				"required": true,
				"system": false,
				"type": "text"
			},
			{
				"hidden": false,
				"id": "upmon_type",
				"maxSelect": 1,
				"name": "type",
				"presentable": false,
				"required": true,
				"system": false,
				"type": "select",
				"values": ["http", "https", "tcp"]
			},
			{
				"hidden": false,
				"id": "upmon_url",
				"max": 500,
				"min": 0,
				"name": "url",
				"pattern": "",
				"presentable": false,
				"primaryKey": false,
				"required": false,
				"system": false,
				"type": "text"
			},
			{
				"hidden": false,
				"id": "upmon_host",
				"max": 255,
				"min": 0,
				"name": "host",
				"pattern": "",
				"presentable": false,
				"primaryKey": false,
				"required": false,
				"system": false,
				"type": "text"
			},
			{
				"hidden": false,
				"id": "upmon_port",
				"max": 65535,
				"min": 1,
				"name": "port",
				"onlyInt": true,
				"presentable": false,
				"required": false,
				"system": false,
				"type": "number"
			},
			{
				"hidden": false,
				"id": "upmon_interval",
				"max": 3600,
				"min": 10,
				"name": "interval",
				"onlyInt": true,
				"presentable": false,
				"required": false,
				"system": false,
				"type": "number"
			},
			{
				"hidden": false,
				"id": "upmon_timeout",
				"max": 120,
				"min": 1,
				"name": "timeout",
				"onlyInt": true,
				"presentable": false,
				"required": false,
				"system": false,
				"type": "number"
			},
			{
				"hidden": false,
				"id": "upmon_status",
				"maxSelect": 1,
				"name": "status",
				"presentable": false,
				"required": false,
				"system": false,
				"type": "select",
				"values": ["up", "down", "unknown"]
			},
			{
				"hidden": false,
				"id": "upmon_response_time",
				"max": null,
				"min": 0,
				"name": "response_time",
				"onlyInt": false,
				"presentable": false,
				"required": false,
				"system": false,
				"type": "number"
			},
			{
				"hidden": false,
				"id": "upmon_last_checked",
				"name": "last_checked",
				"presentable": false,
				"required": false,
				"system": false,
				"type": "date"
			},
			{
				"hidden": false,
				"id": "upmon_enabled",
				"name": "enabled",
				"presentable": false,
				"required": false,
				"system": false,
				"type": "bool"
			},
			{
				"hidden": false,
				"id": "autodate_upmon_created",
				"name": "created",
				"onCreate": true,
				"onUpdate": false,
				"presentable": false,
				"system": false,
				"type": "autodate"
			},
			{
				"hidden": false,
				"id": "autodate_upmon_updated",
				"name": "updated",
				"onCreate": true,
				"onUpdate": true,
				"presentable": false,
				"system": false,
				"type": "autodate"
			}
		],
		"indexes": [],
		"system": false
	},
	{
		"id": "uptime_events_col",
		"listRule": "@request.auth.id != \"\" && monitor.user = @request.auth.id",
		"viewRule": "@request.auth.id != \"\" && monitor.user = @request.auth.id",
		"createRule": null,
		"updateRule": null,
		"deleteRule": null,
		"name": "uptime_events",
		"type": "base",
		"fields": [
			{
				"autogeneratePattern": "[a-z0-9]{15}",
				"hidden": false,
				"id": "text3208210258",
				"max": 15,
				"min": 15,
				"name": "id",
				"pattern": "^[a-z0-9]+$",
				"presentable": false,
				"primaryKey": true,
				"required": true,
				"system": true,
				"type": "text"
			},
			{
				"cascadeDelete": true,
				"collectionId": "uptime_monitors_col",
				"hidden": false,
				"id": "upevt_monitor",
				"maxSelect": 1,
				"minSelect": 0,
				"name": "monitor",
				"presentable": false,
				"required": true,
				"system": false,
				"type": "relation"
			},
			{
				"hidden": false,
				"id": "upevt_up",
				"name": "up",
				"presentable": false,
				"required": false,
				"system": false,
				"type": "bool"
			},
			{
				"hidden": false,
				"id": "upevt_response_time",
				"max": null,
				"min": 0,
				"name": "response_time",
				"onlyInt": false,
				"presentable": false,
				"required": false,
				"system": false,
				"type": "number"
			},
			{
				"hidden": false,
				"id": "upevt_status_code",
				"max": null,
				"min": 0,
				"name": "status_code",
				"onlyInt": true,
				"presentable": false,
				"required": false,
				"system": false,
				"type": "number"
			},
			{
				"hidden": false,
				"id": "upevt_msg",
				"max": 500,
				"min": 0,
				"name": "msg",
				"pattern": "",
				"presentable": false,
				"primaryKey": false,
				"required": false,
				"system": false,
				"type": "text"
			},
			{
				"hidden": false,
				"id": "autodate_upevt_created",
				"name": "created",
				"onCreate": true,
				"onUpdate": false,
				"presentable": false,
				"system": false,
				"type": "autodate"
			}
		],
		"indexes": [
			"CREATE INDEX idx_uptime_events_monitor ON uptime_events (monitor, created DESC)"
		],
		"system": false
	}
]`
		return app.ImportCollectionsByMarshaledJSON([]byte(jsonData), false)
	}, func(app core.App) error {
		// rollback: delete both collections
		for _, name := range []string{"uptime_events", "uptime_monitors"} {
			col, err := app.FindCachedCollectionByNameOrId(name)
			if err == nil {
				_ = app.Delete(col)
			}
		}
		return nil
	})
}
