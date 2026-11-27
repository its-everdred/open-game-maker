import { resolve } from 'node:path';
const intrinsicControls = new Set(['button', 'input', 'select', 'textarea', 'dialog', 'menu']);
const controlRoles = new Set(['button', 'switch', 'slider', 'menu', 'menuitem', 'dialog']);
const controlClasses = /(?:^|[\s_-])(?:panel|sheet|menu|chip|toggle|slider)(?:$|[\s_-])/i;
const designStyle =
  /^(?:color|background(?:Color)?|border(?:.*Color|.*Radius)?|boxShadow|textShadow|backdropFilter|opacity|font(?:Size|Weight)?|lineHeight|letterSpacing|transition(?:Duration|TimingFunction)?|animation(?:Duration|TimingFunction)?)$/;

function rawDesignValue(node) {
  if (node.type === 'ConditionalExpression') return rawDesignValue(node.consequent) || rawDesignValue(node.alternate);
  if (node.type === 'LogicalExpression') return rawDesignValue(node.left) || rawDesignValue(node.right);
  if (node.type === 'BinaryExpression') return true;
  if (node.type === 'TemplateLiteral') {
    if (node.expressions.length) return true;
    return rawDesignValue({ type: 'Literal', value: node.quasis[0].value.cooked });
  }
  if (node.type !== 'Literal') return true;
  const value = node.value;
  return (
    typeof value === 'number' ||
    (typeof value === 'string' && !/^(?:var\(--[\w-]+\)|inherit|none|normal|0)$/.test(value.trim()))
  );
}

function hasControlClass(node) {
  if (node.type === 'Literal') return typeof node.value === 'string' && controlClasses.test(node.value);
  if (node.type === 'TemplateLiteral') return node.quasis.some((part) => controlClasses.test(part.value.cooked ?? ''));
  if (node.type === 'ConditionalExpression') return hasControlClass(node.consequent) || hasControlClass(node.alternate);
  if (node.type === 'LogicalExpression' || node.type === 'BinaryExpression')
    return hasControlClass(node.left) || hasControlClass(node.right);
  return false;
}

function hasControlRole(node) {
  if (node.type === 'Literal') return typeof node.value === 'string' && controlRoles.has(node.value);
  if (node.type === 'ConditionalExpression') return hasControlRole(node.consequent) || hasControlRole(node.alternate);
  if (node.type === 'LogicalExpression') return hasControlRole(node.left) || hasControlRole(node.right);
  return false;
}

// Native controls belong inside the shared library so every screen gets the
// same semantics and states. Test fixtures are excluded by the caller.
export const glassComponentsRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      control: 'Use a shared Glass component for {{name}}.',
      style: 'Use a generated design token for {{name}}.',
      dynamicStyle: 'Inline style properties must be statically inspectable.',
    },
  },
  create(context) {
    function checkStyleObject(expression) {
      if (expression.type === 'ConditionalExpression') {
        checkStyleObject(expression.consequent);
        checkStyleObject(expression.alternate);
        return;
      }
      if (expression.type === 'LogicalExpression' && expression.operator === '&&') {
        checkStyleObject(expression.right);
        return;
      }
      if (expression.type === 'Literal' && (expression.value === null || expression.value === false)) return;
      if (expression.type !== 'ObjectExpression') {
        context.report({ node: expression, messageId: 'dynamicStyle' });
        return;
      }
      for (const property of expression.properties) {
        if (property.type === 'SpreadElement') {
          checkStyleObject(property.argument);
          continue;
        }
        if (property.type !== 'Property') continue;
        const name =
          property.key.type === 'Literal'
            ? property.key.value
            : !property.computed && property.key.type === 'Identifier'
              ? property.key.name
              : undefined;
        if (typeof name !== 'string') {
          context.report({ node: property, messageId: 'dynamicStyle' });
          continue;
        }
        if (!designStyle.test(name)) continue;
        if (rawDesignValue(property.value)) context.report({ node: property, messageId: 'style', data: { name } });
      }
    }
    return {
      JSXOpeningElement(node) {
        if (node.name.type === 'JSXIdentifier' && intrinsicControls.has(node.name.name))
          context.report({ node, messageId: 'control', data: { name: node.name.name } });
        const intrinsic = node.name.type === 'JSXIdentifier' && /^[a-z]/.test(node.name.name);
        for (const attr of node.attributes) {
          if (
            intrinsic &&
            attr.type === 'JSXAttribute' &&
            attr.name.name === 'role' &&
            attr.value &&
            !(
              context.filename === resolve(context.cwd, 'src/components/Dialog.tsx') &&
              attr.value.type === 'Literal' &&
              attr.value.value === 'dialog'
            ) &&
            hasControlRole(attr.value.type === 'JSXExpressionContainer' ? attr.value.expression : attr.value)
          )
            context.report({ node: attr, messageId: 'control', data: { name: 'role' } });
          if (
            intrinsic &&
            attr.type === 'JSXAttribute' &&
            attr.name.name === 'className' &&
            attr.value &&
            hasControlClass(attr.value.type === 'JSXExpressionContainer' ? attr.value.expression : attr.value)
          )
            context.report({ node: attr, messageId: 'control', data: { name: attr.value.value } });
          if (
            attr.type !== 'JSXAttribute' ||
            attr.name.name !== 'style' ||
            attr.value?.type !== 'JSXExpressionContainer'
          )
            continue;
          checkStyleObject(attr.value.expression);
        }
      },
    };
  },
};
