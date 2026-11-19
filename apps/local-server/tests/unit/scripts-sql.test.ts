import { describe, expect, it } from 'vitest';
import { dividirScriptSql } from '../../src/db/scripts-sql.js';

describe('dividirScriptSql', () => {
  it('respeita DELIMITER como o cliente mysql', () => {
    const sql = [
      'CREATE TABLE a (id INT);',
      'CREATE TABLE b (id INT);',
      'DELIMITER $$',
      'CREATE TRIGGER t1 BEFORE INSERT ON a FOR EACH ROW',
      'BEGIN',
      '  SET NEW.id = 1;',
      'END$$',
      'CREATE TRIGGER t2 BEFORE INSERT ON b FOR EACH ROW BEGIN SET NEW.id = 2; END$$',
      'DELIMITER ;',
      '-- só comentário',
    ].join('\r\n');
    const comandos = dividirScriptSql(sql);
    expect(comandos).toHaveLength(3);
    expect(comandos[0]).toContain('CREATE TABLE b');
    expect(comandos[1]).toMatch(/^CREATE TRIGGER t1[\s\S]*END$/);
    expect(comandos[2]).toMatch(/^CREATE TRIGGER t2/);
  });
});
