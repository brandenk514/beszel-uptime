package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// extendMonitors adds uptime-kuma style fields to the existing monitors
// collection. Safe to run multiple times (skips fields that already exist).
func extendMonitors(app core.App) error {
	collection, err := app.FindCollectionByNameOrId("monitors")
	if err != nil {
		return err
	}
	hasField := func(name string) bool {
		for _, f := range collection.Fields {
			if f.GetName() == name {
				return true
			}
		}
		return false
	}

	// add monitor types: dns, docker, websocket, steam, push
	for _, f := range collection.Fields {
		if sf, ok := f.(*core.SelectField); ok && sf.Name == "type" {
			values := sf.Values
			has := func(v string) bool {
				for _, existing := range values {
					if existing == v {
						return true
					}
				}
				return false
			}
			changed := false
			for _, v := range []string{"dns", "docker", "websocket", "steam", "push"} {
				if !has(v) {
					values = append(values, v)
					changed = true
				}
			}
			if changed {
				sf.Values = values
			}
		}
	}

	if !hasField("dns_type") {
		collection.Fields = append(collection.Fields, &core.SelectField{
			Name:   "dns_type",
			Values: []string{"a", "aaaa", "cname", "mx", "txt", "ns"},
		})
	}
	if !hasField("dns_value") {
		collection.Fields = append(collection.Fields, &core.TextField{
			Name: "dns_value", Max: 512,
		})
	}
	if !hasField("app_id") {
		collection.Fields = append(collection.Fields, &core.TextField{
			Name: "app_id", Max: 64,
		})
	}
	if !hasField("docker_url") {
		collection.Fields = append(collection.Fields, &core.TextField{
			Name: "docker_url", Max: 255,
		})
	}
	if !hasField("push_token") {
		collection.Fields = append(collection.Fields, &core.TextField{
			Name: "push_token", Max: 128,
		})
	}
	if !hasField("last_ping") {
		collection.Fields = append(collection.Fields, &core.TextField{
			Name: "last_ping", Max: 64,
		})
	}
	if !hasField("check_cert") {
		collection.Fields = append(collection.Fields, &core.BoolField{
			Name: "check_cert",
		})
	}
	if !hasField("retry_delay") {
		collection.Fields = append(collection.Fields, &core.NumberField{
			Name:    "retry_delay",
			Min:     fnum(0),
			Max:     fnum(60),
			OnlyInt: true,
		})
	}

	return app.Save(collection)
}

// createStatusPages adds the status_pages collection and the monitors relation.
func createStatusPages(app core.App) error {
	if _, err := app.FindCollectionByNameOrId("status_pages"); err == nil {
		return nil // already created
	}

	usersCollection, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}
	monitorsCollection, err := app.FindCollectionByNameOrId("monitors")
	if err != nil {
		return err
	}

	pages := core.NewBaseCollection("status_pages")
	pages.Fields = append(pages.Fields,
		&core.RelationField{
			Name:          "user",
			CollectionId:  usersCollection.Id,
			CascadeDelete: false,
		},
		&core.TextField{
			Name:     "name",
			Required: true,
			Max:      150,
		},
		&core.TextField{
			Name:     "slug",
			Required: true,
			Min:      1,
			Max:      100,
		},
		&core.TextField{
			Name: "description",
			Max:  512,
		},
		&core.BoolField{
			Name: "show_monitors",
		},
		&core.BoolField{
			Name: "enabled",
		},
		&core.AutodateField{
			Name:     "created",
			OnCreate: true,
		},
		&core.AutodateField{
			Name:     "updated",
			OnCreate: true,
			OnUpdate: true,
		},
	)
	pages.AddIndex("idx_status_pages_user", false, "user", "")
	pages.AddIndex("idx_status_pages_slug_unique", true, "slug", "")
	if err := app.Save(pages); err != nil {
		return err
	}

	// link monitors to a single status page (like uptime-kuma's statusPageId)
	hasField := func(name string) bool {
		for _, f := range monitorsCollection.Fields {
			if f.GetName() == name {
				return true
			}
		}
		return false
	}
	if !hasField("status_page") {
		monitorsCollection.Fields = append(monitorsCollection.Fields, &core.RelationField{
			Name:          "status_page",
			CollectionId:  pages.Id,
			CascadeDelete: false,
		})
		if err := app.Save(monitorsCollection); err != nil {
			return err
		}
	}
	return nil
}

func init() {
	m.Register(func(app core.App) error {
		if _, err := app.FindCollectionByNameOrId("monitors"); err != nil {
			return nil // monitors collection not present; nothing to extend
		}
		if err := extendMonitors(app); err != nil {
			return err
		}
		return createStatusPages(app)
	}, nil)
}
