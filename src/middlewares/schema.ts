import { Sanitizers } from '../chain/sanitizers';
import { Validators } from '../chain/validators';
import { CustomValidator, DynamicMessageCreator, Location, Request } from '../base';
import { ValidationChain, ValidatorsImpl } from '../chain';
import { Optional } from '../context';
import { ResultWithContext } from '../chain/context-runner-impl';
import { check } from './check';

type ValidatorSchemaOptions<K extends keyof Validators<any>> =
  | true
  | {
      options?: Parameters<Validators<any>[K]> | Parameters<Validators<any>[K]>[0];
      errorMessage?: DynamicMessageCreator | any;
      negated?: boolean;
      bail?: boolean;
      if?: CustomValidator | ValidationChain | CustomValidator;
    };

export type ValidatorsSchema = { [K in keyof Validators<any>]?: ValidatorSchemaOptions<K> };

type SanitizerSchemaOptions<K extends keyof Sanitizers<any>> =
  | true
  | {
      options?: Parameters<Sanitizers<any>[K]> | Parameters<Sanitizers<any>[K]>[0];
    };

export type SanitizersSchema = { [K in keyof Sanitizers<any>]?: SanitizerSchemaOptions<K> };

type InternalParamSchema = ValidatorsSchema & SanitizersSchema;

/**
 * Defines a schema of validations/sanitizations plus a general validation error message
 * and possible field locations.
 */
export type ParamSchema = InternalParamSchema & {
  in?: Location | Location[];
  errorMessage?: DynamicMessageCreator | any;
  optional?:
    | true
    | {
        options?: Partial<Optional>;
      };
};

/**
 * @deprecated  Only here for v5 compatibility. Please use ParamSchema instead.
 */
export type ValidationParamSchema = ParamSchema;

/**
 * Defines a mapping from field name to a validations/sanitizations schema.
 */
export type Schema = Record<string, ParamSchema>;

/**
 * @deprecated  Only here for v5 compatibility. Please use Schema instead.
 */
export type ValidationSchema = Schema;

const validLocations: Location[] = ['body', 'cookies', 'headers', 'params', 'query'];
const protectedNames = ['errorMessage', 'in'];

export function checkSchema(
  schema: Schema,
  defaultLocations: Location[] = validLocations,
): ValidationChain[] & {
  run: (req: Request) => Promise<ResultWithContext[]>;
} {
  const chains = Object.keys(schema).map(field => { // field 为输入的参数key，config为该参数的验证逻辑
    const config = schema[field];
    const chain = check(field, ensureLocations(config, defaultLocations), config.errorMessage);

    Object.keys(config)
      .filter((method: keyof ParamSchema): method is keyof InternalParamSchema => {
        return config[method] && !protectedNames.includes(method);
      })
      .forEach(method => {
        if (typeof chain[method] !== 'function') {
          console.warn(
            `express-validator: a validator/sanitizer with name ${method} does not exist`,
          );
          return;
        }

        // Using "!" because typescript doesn't know it isn't undefined.
        const methodCfg = config[method]!; // 拿到 method 对应的 配置

        let options: any[] = methodCfg === true ? [] : methodCfg.options ?? []; // 更详细的验证配置，如果没有置为 true，只有基础验证。e.g. custom.options 为 fn
        if (options != null && !Array.isArray(options)) {
          options = [options];
        }

        if (isValidatorOptions(method, methodCfg) && methodCfg.if) {
          chain.if(methodCfg.if);
        }

        if (isValidatorOptions(method, methodCfg) && methodCfg.negated) {
          chain.not();
        }

        (chain[method] as any)(...options); // 调用方法 e.g. isIn() 把 options 传入。实际调用的是 ContextBuilder#addItem，非立即执行

        if (isValidatorOptions(method, methodCfg) && methodCfg.errorMessage) {
          chain.withMessage(methodCfg.errorMessage);
        }

        if (isValidatorOptions(method, methodCfg) && methodCfg.bail) {
          chain.bail();
        }
      });

    return chain;
  });

  const run = async (req: Request) => {
    return await Promise.all(chains.map(chain => chain.run(req)));
  };

  return Object.assign(chains, { run });
}

function isValidatorOptions(
  method: string,
  methodCfg: any,
): methodCfg is Exclude<ValidatorSchemaOptions<any>, true> {
  return methodCfg !== true && method in ValidatorsImpl.prototype;
}

function ensureLocations(config: ParamSchema, defaults: Location[]) { // 验证 position 参数是否有效
  // .filter(Boolean) is done because in can be undefined -- which is not going away from the type
  // See https://github.com/Microsoft/TypeScript/pull/29955 for details
  const locations = Array.isArray(config.in)
    ? config.in
    : ([config.in].filter(Boolean) as Location[]);
  const actualLocations = locations.length ? locations : defaults;

  return actualLocations.filter(location => validLocations.includes(location));
}
