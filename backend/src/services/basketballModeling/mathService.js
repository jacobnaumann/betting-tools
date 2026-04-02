function dot(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += a[i] * b[i];
  return total;
}

function transpose(matrix) {
  if (!matrix.length) return [];
  const rows = matrix.length;
  const cols = matrix[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));

  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      result[j][i] = matrix[i][j];
    }
  }

  return result;
}

function multiplyMatrixMatrix(a, b) {
  const aRows = a.length;
  const aCols = aRows ? a[0].length : 0;
  const bRows = b.length;
  const bCols = bRows ? b[0].length : 0;

  if (aCols !== bRows) throw new Error('Matrix dimension mismatch in multiplyMatrixMatrix.');

  const result = Array.from({ length: aRows }, () => new Array(bCols).fill(0));
  for (let i = 0; i < aRows; i += 1) {
    for (let k = 0; k < aCols; k += 1) {
      const aik = a[i][k];
      for (let j = 0; j < bCols; j += 1) {
        result[i][j] += aik * b[k][j];
      }
    }
  }
  return result;
}

function multiplyMatrixVector(matrix, vector) {
  return matrix.map((row) => dot(row, vector));
}

function solveLinearSystem(matrix, vector) {
  const n = matrix.length;
  if (!n || matrix[0].length !== n || vector.length !== n) {
    throw new Error('Invalid system dimensions for solveLinearSystem.');
  }

  const aug = matrix.map((row, rowIndex) => [...row, vector[rowIndex]]);

  for (let col = 0; col < n; col += 1) {
    let pivotRow = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[pivotRow][col])) {
        pivotRow = row;
      }
    }

    if (Math.abs(aug[pivotRow][col]) < 1e-12) {
      throw new Error('Singular matrix encountered while solving system.');
    }

    if (pivotRow !== col) {
      [aug[col], aug[pivotRow]] = [aug[pivotRow], aug[col]];
    }

    const pivot = aug[col][col];
    for (let j = col; j <= n; j += 1) {
      aug[col][j] /= pivot;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = aug[row][col];
      if (factor === 0) continue;
      for (let j = col; j <= n; j += 1) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  return aug.map((row) => row[n]);
}

module.exports = {
  transpose,
  multiplyMatrixMatrix,
  multiplyMatrixVector,
  solveLinearSystem,
  dot,
};
