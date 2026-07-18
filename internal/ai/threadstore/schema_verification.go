package threadstore

import "database/sql"

type canonicalSchemaObject struct {
	Type  string
	Name  string
	Table string
	SQL   string
}

func readCanonicalSchemaObjects(tx *sql.Tx) ([]canonicalSchemaObject, error) {
	rows, err := tx.Query(`
SELECT type, name, tbl_name, COALESCE(sql, '')
FROM sqlite_master
WHERE name NOT LIKE 'sqlite_%'
  AND name <> '__redeven_db_meta'
ORDER BY type, name
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var objects []canonicalSchemaObject
	for rows.Next() {
		var object canonicalSchemaObject
		if err := rows.Scan(&object.Type, &object.Name, &object.Table, &object.SQL); err != nil {
			return nil, err
		}
		objects = append(objects, object)
	}
	return objects, rows.Err()
}
