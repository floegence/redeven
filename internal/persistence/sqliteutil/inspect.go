package sqliteutil

import (
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
)

func TableExistsTx(tx *sql.Tx, tableName string) (bool, error) {
	if tx == nil {
		return false, errors.New("nil tx")
	}
	tableName = strings.TrimSpace(tableName)
	if tableName == "" {
		return false, errors.New("missing table name")
	}
	var exists int
	if err := tx.QueryRow(`
SELECT COUNT(1)
FROM sqlite_master
WHERE type = 'table' AND name = ?
`, tableName).Scan(&exists); err != nil {
		return false, err
	}
	return exists > 0, nil
}

func IndexExistsTx(tx *sql.Tx, indexName string) (bool, error) {
	if tx == nil {
		return false, errors.New("nil tx")
	}
	indexName = strings.TrimSpace(indexName)
	if indexName == "" {
		return false, errors.New("missing index name")
	}
	var exists int
	if err := tx.QueryRow(`
SELECT COUNT(1)
FROM sqlite_master
WHERE type = 'index' AND name = ?
`, indexName).Scan(&exists); err != nil {
		return false, err
	}
	return exists > 0, nil
}

func ColumnExistsTx(tx *sql.Tx, tableName string, columnName string) (bool, error) {
	if tx == nil {
		return false, errors.New("nil tx")
	}
	tableName = strings.TrimSpace(tableName)
	columnName = strings.TrimSpace(columnName)
	if tableName == "" || columnName == "" {
		return false, errors.New("invalid table/column")
	}

	rows, err := tx.Query(fmt.Sprintf(`PRAGMA table_info(%s)`, quoteIdentifier(tableName)))
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var ctype string
		var notNull int
		var defaultValue sql.NullString
		var primaryKey int
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &defaultValue, &primaryKey); err != nil {
			return false, err
		}
		if strings.EqualFold(strings.TrimSpace(name), columnName) {
			return true, nil
		}
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	return false, nil
}

func ListUserTablesTx(tx *sql.Tx) ([]string, error) {
	if tx == nil {
		return nil, errors.New("nil tx")
	}
	rows, err := tx.Query(`
SELECT name
FROM sqlite_master
WHERE type = 'table'
  AND name NOT LIKE 'sqlite_%'
  AND name <> ?
ORDER BY name ASC
`, metaTableName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		tables = append(tables, name)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Strings(tables)
	return tables, nil
}

func quoteIdentifier(name string) string {
	return `"` + strings.ReplaceAll(strings.TrimSpace(name), `"`, `""`) + `"`
}
