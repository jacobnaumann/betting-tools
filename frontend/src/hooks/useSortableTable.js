import { useMemo, useState } from 'react';

function compareValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return Number(a) - Number(b);
  }

  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export function useSortableTable(rows, defaultSort) {
  const [sortConfig, setSortConfig] = useState(defaultSort);

  const sortedRows = useMemo(() => {
    const baseRows = Array.isArray(rows) ? [...rows] : [];
    if (!sortConfig?.key) return baseRows;

    const directionFactor = sortConfig.direction === 'desc' ? -1 : 1;
    baseRows.sort((leftRow, rightRow) => {
      const result = compareValues(leftRow[sortConfig.key], rightRow[sortConfig.key]);
      return result * directionFactor;
    });
    return baseRows;
  }, [rows, sortConfig]);

  const requestSort = (key) => {
    setSortConfig((previous) => {
      if (previous?.key === key) {
        return {
          key,
          direction: previous.direction === 'asc' ? 'desc' : 'asc',
        };
      }

      return {
        key,
        direction: 'asc',
      };
    });
  };

  const getSortIndicator = (key) => {
    if (sortConfig?.key !== key) return '';
    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };

  return {
    sortedRows,
    sortConfig,
    requestSort,
    getSortIndicator,
  };
}
