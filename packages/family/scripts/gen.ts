/** 写出 family.json（总站 apps.us-cloud.uk 放的那份）：照 src/list.ts 里软件带的名单。test/family.test.ts 比对两边一样 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN } from '../src/list.ts'

writeFileSync(join(import.meta.dirname, '../family.json'), JSON.stringify(BUILTIN, null, 2) + '\n')
