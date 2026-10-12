import { parse } from 'acorn';

const FAILURE = 'frontend_location_contract_changed';
const ENTRY_PATH = /^\/daily-checkin-h5\/assets\/index-[A-Za-z0-9_-]+\.js$/;
const STUDENT_PATH = /^\/daily-checkin-h5\/assets\/pages-student-report-today-home-index\.[A-Za-z0-9_-]+\.js$/;
const STUDENT_MARKER = 'pages-student-report-today-home-index.';
const fail = () => { throw new Error(FAILURE); };

function canonicalOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') fail();
  return url.origin;
}

function assetUrl(value, origin, pattern, base) {
  if (typeof value !== 'string' || !value || /[\\%\s?#]/.test(value) || /(?:^|\/)\.\.(?:\/|$)/.test(value)) fail();
  const url = base ? new URL(value, base) : new URL(value);
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || url.search || url.hash || !pattern.test(url.pathname)) fail();
  return url.href;
}

function sourceAst(source, limit) {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > limit) fail();
  return parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

function keyName(property) {
  if (property.type !== 'Property' || property.computed) return null;
  return property.key.type === 'Identifier' ? property.key.name : property.key.value;
}

function isLocationCall(node) {
  if (node.type !== 'CallExpression' || node.optional || node.callee.type !== 'Identifier' || node.arguments[0]?.type !== 'ObjectExpression') return false;
  const properties = node.arguments[0].properties;
  const typeProperties = properties.filter(property => keyName(property) === 'type');
  if (!typeProperties.some(property => property.value?.type === 'Literal' && property.value.value === 'gcj02')) return false;
  // A spread or computed key can overwrite any required option at runtime.
  if (properties.some(property => property.type === 'SpreadElement' || property.computed)) fail();
  const required = name => properties.filter(property => keyName(property) === name);
  const success = required('success');
  const failure = required('fail');
  if (typeProperties.length !== 1 || success.length !== 1 || failure.length !== 1) fail();
  if (typeProperties[0].kind !== 'init' || typeProperties[0].value?.type !== 'Literal' || typeProperties[0].value.value !== 'gcj02') fail();
  const callback = property => property.kind === 'init' && ['FunctionExpression', 'ArrowFunctionExpression'].includes(property.value?.type);
  if (!callback(success[0]) || !callback(failure[0])) fail();
  return true;
}

function declaredNames(pattern) {
  if (!pattern) return [];
  if (pattern.type === 'Identifier') return [pattern.name];
  if (pattern.type === 'RestElement') return declaredNames(pattern.argument);
  if (pattern.type === 'AssignmentPattern') return declaredNames(pattern.left);
  if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(declaredNames);
  if (pattern.type === 'ObjectPattern') return pattern.properties.flatMap(property => declaredNames(property.type === 'RestElement' ? property.argument : property.value));
  return [];
}

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

// Collect declarations before resolving calls, so var hoisting and lexical TDZ
// cannot turn a local binding into an apparently imported one.
function locationCalls(ast) {
  const calls = [];
  const root = { parent: null, names: new Set(), functionScope: true };
  const add = (scope, pattern) => declaredNames(pattern).forEach(name => scope.names.add(name));
  function visit(node, parentScope) {
    if (!node || typeof node !== 'object' || !node.type) return;
    let scope = parentScope;
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') add(parentScope, node.id);
    if (FUNCTION_TYPES.has(node.type) || ['BlockStatement', 'StaticBlock', 'CatchClause', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement', 'ClassExpression', 'ClassDeclaration'].includes(node.type)) {
      scope = { parent: parentScope, names: new Set(), functionScope: FUNCTION_TYPES.has(node.type) || node.type === 'StaticBlock' };
      if (FUNCTION_TYPES.has(node.type)) {
        add(scope, node.id);
        node.params.forEach(param => add(scope, param));
      } else if (node.type === 'CatchClause') add(scope, node.param);
      else if (node.type === 'ClassExpression' || node.type === 'ClassDeclaration') add(scope, node.id);
    }
    if (node.type === 'VariableDeclaration') {
      let declarationScope = scope;
      if (node.kind === 'var') while (!declarationScope.functionScope) declarationScope = declarationScope.parent;
      node.declarations.forEach(declaration => add(declarationScope, declaration.id));
    }
    if (isLocationCall(node)) calls.push({ node, scope });
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => visit(child, scope));
      else if (value && typeof value === 'object') visit(value, scope);
    }
  }
  visit(ast, root);
  return calls;
}

function isShadowed(scope, name) {
  for (let current = scope; current; current = current.parent) if (current.names.has(name)) return true;
  return false;
}

function exportsName(ast, name) {
  return ast.body.some(node => {
    if (node.type !== 'ExportNamedDeclaration' || node.source) return false;
    if (node.specifiers.some(specifier => (specifier.exported.name ?? specifier.exported.value) === name)) return true;
    const declaration = node.declaration;
    if (declaration?.type === 'VariableDeclaration') return declaration.declarations.some(item => declaredNames(item.id).includes(name));
    return declaration?.id?.name === name;
  });
}

/** Resolve the imported export actually used by the student's location call. */
export function resolveLocationBinding({ entryUrl, entrySource, studentUrl, studentSource, origin = 'https://jzsz.uestc.edu.cn' } = {}) {
  try {
    const trustedOrigin = canonicalOrigin(origin);
    const entry = assetUrl(entryUrl, trustedOrigin, ENTRY_PATH);
    const student = assetUrl(studentUrl, trustedOrigin, STUDENT_PATH);
    const entryAst = sourceAst(entrySource, 2 * 1024 * 1024);
    const studentAst = sourceAst(studentSource, 256 * 1024);
    const imports = new Map();
    for (const node of studentAst.body) {
      if (node.type !== 'ImportDeclaration') continue;
      for (const specifier of node.specifiers) imports.set(specifier.local.name, { node, specifier });
    }
    const bindings = new Set();
    for (const { node, scope } of locationCalls(studentAst)) {
      const imported = imports.get(node.callee.name);
      if (!imported || imported.specifier.type !== 'ImportSpecifier') fail();
      if (assetUrl(imported.node.source.value, trustedOrigin, ENTRY_PATH, student) !== entry) fail();
      // A nested declaration may shadow an import; reject instead of guessing scope.
      if (isShadowed(scope, node.callee.name)) fail();
      const exportName = imported.specifier.imported.name ?? imported.specifier.imported.value;
      if (typeof exportName !== 'string' || !exportsName(entryAst, exportName)) fail();
      bindings.add(node.callee.name);
    }
    if (bindings.size !== 1) fail();
    const binding = imports.get([...bindings][0]).specifier;
    return { entryUrl: entry, studentUrl: student, exportName: binding.imported.name ?? binding.imported.value };
  } catch { fail(); }
}

/** Discover the single student chunk referenced by literal strings in the entry. */
export function findStudentModule({ entryUrl, entrySource, origin = 'https://jzsz.uestc.edu.cn' } = {}) {
  try {
    const trustedOrigin = canonicalOrigin(origin);
    const entry = assetUrl(entryUrl, trustedOrigin, ENTRY_PATH);
    const ast = sourceAst(entrySource, 2 * 1024 * 1024);
    const candidates = new Set();
    walk(ast, node => {
      if (node.type !== 'Literal' || typeof node.value !== 'string' || !node.value.includes(STUDENT_MARKER)) return;
      candidates.add(assetUrl(node.value, trustedOrigin, STUDENT_PATH, entry));
    });
    if (candidates.size !== 1) fail();
    return [...candidates][0];
  } catch { fail(); }
}
